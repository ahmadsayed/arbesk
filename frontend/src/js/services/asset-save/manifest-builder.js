// @ts-nocheck
/**
 * Manifest construction helpers for save/publish.
 *
 * Handles loading the current manifest, applying pending edits (child refs,
 * source colors, post-processor colors, transforms), decomposing monolithic
 * glTF nodes, versioning the manifest chain, and writing the final manifest
 * to IPFS.
 */

import {
  getFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
} from "../../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";
import { snapshotCommentsArchive } from "../api.js";
import { getTokenURI } from "../token.js";
import { getPendingChildRefs } from "../../engine/scene-graph.js";
import { isComposite } from "../../gltf/decomposer.js";
import {
  decomposeAndStoreAsync,
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";
import { editCompositeColors } from "../../gltf/material-editor.js";
import { buildDedupMap } from "../../gltf/dedup.js";
import {
  getPendingSourceColorEdits,
  clearPendingSourceColorEdits,
} from "../../engine/parametric-preview.js";
import {
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  getPendingTransformEdits,
  clearPendingTransformEdits,
  clearPendingChildRefs,
  captureAssetThumbnail,
} from "../../engine/scene-graph.js";
import { assetState } from "../../state/asset-state.js";
import { log, warn } from "../../utils/log.js";

function isRateLimitError(err) {
  if (!err || typeof err.message !== "string") return false;
  return (
    err.message.includes("HTTP 429") ||
    err.message.includes("Too Many Requests")
  );
}

export function advanceManifestVersion(manifest, latestCid) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.prev_asset_manifest_cid =
    latestCid || assetState.get().activeAssetManifestCid || null;
}

/**
 * Compare two manifests for semantic equality, ignoring auto-generated fields.
 */
export function manifestsSemanticallyEqual(a, b) {
  if (!a || !b) return false;
  const strip = (m) => {
    const copy = JSON.parse(JSON.stringify(m));
    delete copy.timestamp;
    delete copy.version;
    delete copy.prev_asset_manifest_cid;
    return copy;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Try to decompose a single node's source asset.
 * Returns a { nodeId, cid, path, format } result or null if not applicable.
 */
async function _decomposeOneNode(node, manifest, dedupMap = null) {
  if (!node.source?.cid || node.child_ref) return null;

  const cid = node.source.cid;
  const format = (node.source.format || "gltf").toLowerCase();
  log(
    `Decompose save: checking node ${node.node_id} | sourceCid=${cid} format=${format}`
  );

  try {
    if (format === "glb") {
      const glbBuffer = await getArrayBufferFromRemoteIPFS(cid);
      const { compositeCid } = await decomposeGLBAsync(glbBuffer, true, {
        assetName: manifest.name,
        assetId: manifest.asset_id,
        dedupMap,
      });
      log(
        `Decompose save: node ${node.node_id} GLB decomposed | old=${cid} new=${compositeCid}`
      );
      return {
        nodeId: node.node_id,
        cid: compositeCid,
        path: "composite.gltf",
        format: "gltf",
      };
    }

    const gltf = await getFromRemoteIPFS(cid);
    if (!gltf.asset?.version) {
      log(`Decompose save: CID ${cid} is not a glTF, skipping`);
      return null;
    }
    if (isComposite(gltf)) {
      log(
        `Decompose save: node ${node.node_id} already composite, skipping`
      );
      return null;
    }

    const { compositeCid } = await decomposeAndStoreAsync(gltf, {
      assetName: manifest.name,
      assetId: manifest.asset_id,
      dedupMap,
    });
    log(
      `Decompose save: node ${node.node_id} decomposed | old=${cid} new=${compositeCid}`
    );
    return { nodeId: node.node_id, cid: compositeCid, path: "composite.gltf" };
  } catch (err) {
    if (isRateLimitError(err)) throw err;
    warn(
      `Decompose save: failed to decompose node ${node.node_id}:`,
      err.message
    );
    return null;
  }
}

/**
 * Decompose all monolithic glTF source nodes in a manifest.
 * Fetches each glTF, decomposes buffers/images to separate IPFS CIDs,
 * and updates node.source.cid to point to the composite JSON.
 * Already-composite nodes (ipfs:// URIs) are skipped.
 *
 * @param {object} manifest - The manifest being prepared for write
 * @returns {Promise<number>} Count of nodes decomposed
 */
export async function decomposeManifestNodes(manifest, dedupMap = null) {
  const nodes = manifest.scene?.nodes || [];

  const jobs = nodes.map((node) => _decomposeOneNode(node, manifest, dedupMap));

  const results = await Promise.allSettled(jobs);
  let decomposed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const node = nodes.find((n) => n.node_id === r.value.nodeId);
    if (!node) continue;
    node.source.cid = r.value.cid;
    node.source.path = r.value.path;
    if (r.value.format) node.source.format = r.value.format;
    decomposed++;
  }

  return decomposed;
}

/**
 * Resolve the canonical "latest" manifest CID for versioning.
 * Prefer the in-memory tip of the version chain (latest draft) so every
 * Save appends linearly. Only fall back to the on-chain tokenURI for
 * tokenized assets when no in-memory latest exists yet (e.g. on first load).
 * For drafts without a token, fall back to the currently loaded manifest.
 */
export async function resolveLatestManifestCid() {
  if (assetState.get().latestAssetManifestCid) {
    return assetState.get().latestAssetManifestCid;
  }

  const tokenId = assetState.get().activeAssetTokenId;
  if (tokenId) {
    try {
      const onChainCid = await getTokenURI(tokenId);
      if (onChainCid) {
        log(
          `Save: using on-chain tokenURI for token #${tokenId} → ${onChainCid}`
        );
        return onChainCid;
      }
    } catch (err) {
      warn(
        `Save: failed to read on-chain tokenURI for #${tokenId}:`,
        err.message
      );
    }
  }
  return assetState.get().activeAssetManifestCid || null;
}

/**
 * Build a hash → CID map from the composite glTFs referenced by one or more
 * asset manifests. Used to skip re-uploading unchanged buffers/images when
 * saving a new version.
 */
async function buildDedupMapFromManifests(manifests) {
  const composites = [];
  for (const manifest of manifests) {
    if (!manifest?.scene?.nodes) continue;
    const jobs = manifest.scene.nodes
      .filter(
        (n) =>
          n.source?.cid &&
          (n.source.path === "composite.gltf" || n.source.format === "gltf")
      )
      .map(async (n) => {
        try {
          return await getFromRemoteIPFS(n.source.cid);
        } catch (err) {
          warn(
            `Save: failed to fetch composite for dedup | cid=${n.source.cid}:`,
            err.message
          );
          return null;
        }
      });
    const results = await Promise.all(jobs);
    for (const composite of results) {
      if (composite) composites.push(composite);
    }
  }
  return buildDedupMap(composites);
}

export async function prepareManifestForWrite(assetName) {
  let manifest;
  const pendingRefs = getPendingChildRefs();
  const pendingPP = getPendingPostProcessorEdits();
  const pendingTransforms = getPendingTransformEdits();
  const pendingColors = getPendingSourceColorEdits();

  if (assetState.get().activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(assetState.get().activeAssetManifestCid);
    manifest.type = "asset";
  } else if (
    pendingRefs.length > 0 ||
    pendingPP.size > 0 ||
    pendingTransforms.size > 0 ||
    pendingColors.size > 0
  ) {
    manifest = {
      type: "asset",
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
    log(
      `Save: creating fresh manifest for ${pendingRefs.length} pending child refs / ${pendingPP.size} pending post-processor edits / ${pendingTransforms.size} pending transform edits / ${pendingColors.size} pending source color edits`
    );
  } else {
    return null;
  }

  manifest.name = assetName;
  manifest.asset_id ||= `asset_${Date.now()}`;
  // Always refresh the timestamp so every saved/published version is a
  // distinct IPFS object. This prevents Pinata (and other backends that
  // reject exact duplicates) from returning a 409 when a manifest is saved
  // again without semantic changes.
  manifest.timestamp = Date.now();
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];

  for (const pendingNode of pendingRefs) {
    if (!manifest.scene.nodes.some((n) => n.node_id === pendingNode.node_id)) {
      manifest.scene.nodes.push(pendingNode);
    }
  }

  // Resolve the previous manifest(s) early so we can build a hash→CID map for
  // component deduplication. We fetch both the active manifest and the latest
  // chain tip; either may reference composites whose buffers/images can be
  // reused without re-uploading.
  const activeCid = assetState.get().activeAssetManifestCid;
  const latestCid = await resolveLatestManifestCid();
  log(
    `Save: versioning base | active=${activeCid} latest=${
      assetState.get().latestAssetManifestCid
    } onChain=${
      assetState.get().activeAssetTokenId || "none"
    } chosenPrev=${latestCid}`
  );

  const cidToFetch = new Map();
  if (activeCid) cidToFetch.set(activeCid, "base");
  if (latestCid && latestCid !== activeCid) cidToFetch.set(latestCid, "prev");

  const fetched = new Map();
  await Promise.all(
    [...cidToFetch.entries()].map(async ([cid, key]) => {
      try {
        fetched.set(cid, await getFromRemoteIPFS(cid));
      } catch {
        // Leave missing manifests as undefined; callers fall back gracefully.
      }
    })
  );

  const baseManifest = fetched.get(activeCid) || null;
  const prevManifest =
    (latestCid ? fetched.get(latestCid) : null) || baseManifest;
  const dedupMap = await buildDedupMapFromManifests(
    [baseManifest, prevManifest].filter(Boolean)
  );
  log(`Save: dedup map built | entries=${dedupMap.size}`);

  // Apply direct source color edits.
  // These mutate the source glTF/GLB asset and update node.source.cid.
  // Each node is independent, so bake them concurrently.
  if (pendingColors.size > 0) {
    const colorJobs = [];
    for (const [nodeId, nodeEdits] of pendingColors) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node || !node.source?.cid) continue;

      const colorMap = {};
      for (const [meshName, color] of nodeEdits) {
        colorMap[meshName] = color;
      }

      colorJobs.push(
        (async () => {
          try {
            const result = await editSourceColorsAsync(
              node.source.cid,
              colorMap,
              {
                assetName: manifest.name,
                assetId: manifest.asset_id,
                dedupMap,
              }
            );
            return { nodeId, result };
          } catch (err) {
            if (isRateLimitError(err)) throw err;
            warn(
              `Save: failed to bake colors into source for ${nodeId}:`,
              err.message
            );
            return null;
          }
        })()
      );
    }

    const colorResults = await Promise.allSettled(colorJobs);
    for (const r of colorResults) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const { nodeId, result } = r.value;
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;
      node.source.cid = result.sourceCid;
      // The edited source is always glTF JSON now; keep the node's
      // format/path truthful so the loader doesn't treat it as a binary GLB.
      if (result.format) node.source.format = result.format;
      if (result.path) node.source.path = result.path;
      log(
        `Save: baked colors into source | node=${nodeId} newCid=${result.sourceCid} format=${node.source.format} modified=${result.modified} skipped=${result.skipped}`
      );
    }
  }

  // Apply post-processor edits.
  // Decomposed nodes: bake colors directly into the composite glTF.
  // Monolithic nodes: store as node.post_processor (runtime overlay).
  if (pendingPP.size > 0) {
    const ppJobs = [];
    for (const [nodeId, pp] of pendingPP) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;

      const isDecomposed =
        node.source?.path === "composite.gltf" && node.source?.cid;

      if (isDecomposed && (pp.color || pp.meshOverrides)) {
        // Decomposed nodes need an async composite bake. Capture the node id
        // and the edit payload so we can apply the result later.
        ppJobs.push(
          (async () => {
            let result = null;
            try {
              result = await editCompositeColors(
                node.source.cid,
                pp.meshOverrides || null,
                pp.color || null,
                {
                  assetName: manifest.name,
                  assetId: manifest.asset_id,
                }
              );
              log(
                `Save: baked colors into composite glTF | node=${nodeId} newCid=${result.compositeCid}`
              );
            } catch (err) {
              warn(
                `Save: failed to bake colors into composite glTF for ${nodeId}:`,
                err.message
              );
            }
            return { nodeId, pp, result };
          })()
        );
      } else {
        // Monolithic node - store as post_processor overlay (also covers
        // decomposed nodes with only scale edits, which don't need a fetch).
        node.post_processor ||= {};
        if (pp.color !== undefined) node.post_processor.color = pp.color;
        if (pp.scale !== undefined) node.post_processor.scale = { ...pp.scale };
        if (pp.meshOverrides && Object.keys(pp.meshOverrides).length > 0)
          node.post_processor.meshOverrides = { ...pp.meshOverrides };
        else if (node.post_processor.meshOverrides)
          delete node.post_processor.meshOverrides;
      }
    }

    const ppResults = await Promise.allSettled(ppJobs);
    for (const r of ppResults) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const { nodeId, pp, result } = r.value;
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;

      if (result) {
        node.source.cid = result.compositeCid;
      }

      // Scale still goes to post_processor (geometry, not material)
      if (
        pp.scale &&
        (pp.scale.x !== 1 || pp.scale.y !== 1 || pp.scale.z !== 1)
      ) {
        node.post_processor ||= {};
        node.post_processor.scale = { ...pp.scale };
      } else if (node.post_processor) {
        delete node.post_processor.scale;
      }
      // Clean up empty post_processor
      if (
        node.post_processor &&
        Object.keys(node.post_processor).length === 0
      ) {
        delete node.post_processor;
      }
    }

    log(
      `Save: applied ${pendingPP.size} pending post-processor edit(s)`
    );
  }

  // Apply viewport gizmo transform edits.
  // Updates node.transform_matrix so the saved manifest renders the node
  // in its edited position/rotation/scale on next load.
  if (pendingTransforms.size > 0) {
    for (const [nodeId, matrixArray] of pendingTransforms) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;
      node.transform_matrix = matrixArray;
      log(`Save: applied transform edit | node=${nodeId}`);
    }
  }

  // Decompose monolithic glTF nodes into composite (ipfs://) format.
  // Only affects glTF nodes that haven't been decomposed yet.
  // Runs on both Save Draft and Publish.
  const decomposedCount = await decomposeManifestNodes(manifest, dedupMap);
  if (decomposedCount > 0) {
    log(
      `Save: decomposed ${decomposedCount} glTF node(s) to composite format`
    );
  }

  // prevManifest is the tip of the chain that supplies version + prev link
  // and is also the baseline for no-op detection. When the user has navigated
  // to an older version (v2 of v1..v6), edits/saves still append to the tip
  // as the next linear version (v7), not branch off as v3.
  if (prevManifest) {
    manifest.version = (prevManifest.version || 0) + 1;
    manifest.prev_asset_manifest_cid = latestCid;
  } else if (latestCid) {
    advanceManifestVersion(manifest, latestCid);
  }

  return {
    manifest,
    prevCid: latestCid,
    prevManifest: prevManifest || baseManifest,
  };
}

export async function saveAssetDraftCore(
  assetName,
  { captureThumbnail = false, publishContext = null } = {}
) {
  const prepared = await prepareManifestForWrite(assetName);
  if (!prepared) {
    return { ok: false, reason: "empty" };
  }

  if (captureThumbnail) {
    try {
      const thumbnail = await captureAssetThumbnail();
      if (thumbnail?.cid) {
        prepared.manifest.thumbnail = prepared.manifest.thumbnail?.cid
          ? { ...prepared.manifest.thumbnail, cid: thumbnail.cid }
          : thumbnail;
      }
    } catch (thumbnailError) {
      warn("[SAVE] thumbnail capture skipped:", thumbnailError.message);
    }
  }

  if (
    prepared.prevManifest &&
    manifestsSemanticallyEqual(prepared.manifest, prepared.prevManifest)
  ) {
    // Pending edits are already reflected in the prepared manifest (otherwise
    // it would differ from the previous one). Clear them so the UI doesn't
    // keep trying to re-apply a settled state.
    clearPendingChildRefs();
    clearPendingPostProcessorEdits();
    clearPendingTransformEdits();
    clearPendingSourceColorEdits();
    return {
      ok: false,
      reason: "no-changes",
      cid: prepared.prevCid,
      manifest: prepared.prevManifest,
    };
  }

  // Write manifest directly to IPFS - no backend middleman.
  // The browser already writes glTF buffers and textures this way.
  let cid = await writeJSONToIPFS(prepared.manifest, null, {
    type: prepared.manifest.type,
    assetId: prepared.manifest.asset_id,
  });

  // On republish, snapshot the Nostr comment thread to IPFS so the
  // archive CID is embedded in the manifest. Failures are logged
  // but never block the save - the manifest is already uploaded.
  if (publishContext?.tokenId) {
    try {
      const archiveContext = {
        ...publishContext,
        assetId: prepared.manifest.asset_id,
      };
      const { cid: archiveCid } = await snapshotCommentsArchive(archiveContext);
      prepared.manifest.comments_archive_cid = archiveCid;
      // Re-upload with the archive CID - content differs, so CID changes.
      cid = await writeJSONToIPFS(prepared.manifest, null, {
        type: prepared.manifest.type,
        assetId: prepared.manifest.asset_id,
      });
    } catch (archiveErr) {
      warn(`[SAVE] comments archive skipped: ${archiveErr.message}`);
    }
  }

  assetState.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
  });

  clearPendingChildRefs();
  clearPendingPostProcessorEdits();
  clearPendingTransformEdits();
  clearPendingSourceColorEdits();

  return {
    ok: true,
    cid,
    manifest: prepared.manifest,
    prevCid: prepared.prevCid,
  };
}
