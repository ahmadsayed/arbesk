// @ts-nocheck
/**
 * Manifest construction helpers for save/publish.
 *
 * Handles loading the current manifest, applying pending edits (child refs,
 * source colors, post-processor colors, transforms), decomposing monolithic
 * glTF nodes, versioning the manifest chain, and writing the final manifest
 * to IPFS.
 */

import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";
import { snapshotCommentsArchive } from "../api.js";
import { getTokenURI } from "../token.js";
import { getPendingChildRefs } from "../../engine/scene-graph.js";
import { resolveFormatHandler } from "../../formats/index.js";
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
import { assetState, tagManifestCid } from "../../state/asset-state.js";
import { log, warn } from "../../utils/log.js";

function isRateLimitError(err) {
  if (!err || typeof err.message !== "string") return false;
  return (
    err.message.includes("HTTP 429") ||
    err.message.includes("Too Many Requests")
  );
}

/**
 * Use the in-memory manifest if it matches the active CID.
 * Avoids a round-trip to IPFS when the manifest was just produced by a
 * previous save/publish in the same session.
 */
function _useCachedManifest(activeCid) {
  if (!activeCid) return null;
  const cached = assetState.get().currentManifest;
  const hasAssetId = !!cached?.asset_id;
  const cachedCid = cached?._manifestCid || null;
  const hit = hasAssetId && (!cachedCid || cachedCid === activeCid);
  log(
    `Save: manifest cache | active=${activeCid} cachedCid=${cachedCid} hasAssetId=${hasAssetId} hit=${hit}`
  );
  if (!hit) return null;
  const copy = JSON.parse(JSON.stringify(cached));
  delete copy._manifestCid;
  return copy;
}

/**
 * In-memory cache of CIDs we have already verified are composite glTFs.
 * Persists across saves within the same session so a source only pays the
 * verification fetch once.
 */
const _verifiedCompositeCids = new Set();

/**
 * Heuristic: a source node that already points to its stored form.
 * For glTF this is `format: "gltf"` + `path: "composite.gltf"`; other formats
 * declare their own stored-form predicate via the format handler.
 * Lets us skip an expensive IPFS fetch on no-op save/publish cycles.
 */
function looksStored(node) {
  if (!node.source?.cid || node.child_ref) return false;
  if (_verifiedCompositeCids.has(node.source.cid)) return true;
  return resolveFormatHandler(node.source).isStoredForm(node);
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
 *
 * @param {object} node
 * @param {object} manifest
 * @param {Map<string,string>} [dedupMap]
 * @param {Map<string,*>} [pendingColorEdits] - Source-color edits still to be
 *   applied. When a node has a pending edit we cannot take the fast path,
 *   because baking colors into a GLB produces a monolithic glTF that still
 *   carries the "composite.gltf" path marker and needs one more decomposition.
 */
async function _decomposeOneNode(
  node,
  manifest,
  dedupMap = null,
  pendingColorEdits = null
) {
  if (!node.source?.cid || node.child_ref) return null;

  const cid = node.source.cid;
  const format = (node.source.format || "gltf").toLowerCase();
  log(
    `Decompose save: checking node ${node.node_id} | sourceCid=${cid} format=${format}`
  );

  // Fast path: already-stored sources don't need a fetch to verify.
  // Skip only when no source-color edit is pending for this node.
  if (looksStored(node) && !pendingColorEdits?.has(node.node_id)) {
    log(`Decompose save: node ${node.node_id} already stored (fast path)`);
    return null;
  }

  try {
    const handler = resolveFormatHandler(node.source);
    const result = await handler.decomposeForSave(node, {
      assetName: manifest.name,
      assetId: manifest.asset_id,
      dedupMap,
    });
    if (!result) return null;

    _verifiedCompositeCids.add(result.cid);
    if (result.normalizeOnly) {
      log(
        `Decompose save: node ${node.node_id} already composite, normalizing path`
      );
    } else {
      log(
        `Decompose save: node ${node.node_id} decomposed | old=${cid} new=${result.cid}`
      );
    }
    return {
      nodeId: node.node_id,
      cid: result.cid,
      path: result.path,
      format: result.format,
      normalizeOnly: result.normalizeOnly,
    };
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
 * @param {Map<string,string>} [dedupMap]
 * @param {Map<string,*>} [pendingColorEdits]
 * @returns {Promise<number>} Count of nodes decomposed
 */
export async function decomposeManifestNodes(
  manifest,
  dedupMap = null,
  pendingColorEdits = null
) {
  const nodes = manifest.scene?.nodes || [];

  const jobs = nodes.map((node) =>
    _decomposeOneNode(node, manifest, dedupMap, pendingColorEdits)
  );

  const results = await Promise.allSettled(jobs);
  let decomposed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const node = nodes.find((n) => n.node_id === r.value.nodeId);
    if (!node) continue;
    node.source.cid = r.value.cid;
    node.source.path = r.value.path;
    if (r.value.format) node.source.format = r.value.format;
    if (!r.value.normalizeOnly) decomposed++;
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
          (resolveFormatHandler(n.source).isDedupSource?.(n) ?? false)
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

  const activeCid = assetState.get().activeAssetManifestCid;
  if (activeCid) {
    manifest = _useCachedManifest(activeCid);
    if (!manifest) {
      manifest = await getFromRemoteIPFS(activeCid);
    }
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

  // Resolve the previous manifest(s) for versioning and, when needed, build a
  // hash→CID map for component deduplication. Reuse the already-loaded active
  // manifest as the base; only fetch the latest chain tip when it differs.
  const latestCid = await resolveLatestManifestCid();
  log(
    `Save: versioning base | active=${activeCid} latest=${
      assetState.get().latestAssetManifestCid
    } onChain=${
      assetState.get().activeAssetTokenId || "none"
    } chosenPrev=${latestCid}`
  );

  const baseManifest = manifest;
  // prevManifest is the versioning + no-op-detection baseline. It MUST be a
  // snapshot of the manifest as it is now — before decomposeManifestNodes()
  // mutates `manifest` in place below. Aliasing the live manifest here makes the
  // later manifestsSemanticallyEqual() check compare the manifest against
  // itself, so every first save of a fresh draft (latestCid === activeCid) is
  // wrongly reported as "no changes" and never written. Fetch the distinct chain
  // tip when it differs; otherwise clone the current manifest.
  const prevManifest =
    latestCid && latestCid !== activeCid
      ? (await getFromRemoteIPFS(latestCid).catch(() => null)) ||
        JSON.parse(JSON.stringify(baseManifest))
      : JSON.parse(JSON.stringify(baseManifest));

  const sourceNodes = manifest.scene.nodes.filter(
    (n) => n.source?.cid && !n.child_ref
  );
  const needsDedup =
    pendingColors.size > 0 || sourceNodes.some((n) => !looksStored(n));

  const dedupMap = needsDedup
    ? await buildDedupMapFromManifests(
        [baseManifest, prevManifest].filter(Boolean)
      )
    : new Map();
  log(`Save: dedup map built | entries=${dedupMap.size} skipped=${!needsDedup}`);

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
            const handler = resolveFormatHandler(node.source);
            if (typeof handler.editSourceColors !== "function") {
              warn(
                `Save: source-color edit unsupported for format ${handler.format} | node=${nodeId}`
              );
              return null;
            }
            const result = await handler.editSourceColors(node, colorMap, {
              assetName: manifest.name,
              assetId: manifest.asset_id,
              dedupMap,
            });
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
        !!node.source?.cid && resolveFormatHandler(node.source).isStoredForm(node);

      if (isDecomposed && (pp.color || pp.meshOverrides)) {
        // Decomposed nodes need an async composite bake. Capture the node id
        // and the edit payload so we can apply the result later.
        ppJobs.push(
          (async () => {
            let result = null;
            const handler = resolveFormatHandler(node.source);
            if (typeof handler.editCompositeColors !== "function") {
              // Fall through to overlay path by returning null.
              return { nodeId, pp, result };
            }
            try {
              result = await handler.editCompositeColors(
                node,
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
  const decomposedCount = await decomposeManifestNodes(
    manifest,
    dedupMap,
    pendingColors
  );
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
  // Thumbnail capture (canvas read + upload) is independent of manifest
  // preparation, so run both concurrently. Failures are non-fatal.
  const thumbnailPromise = captureThumbnail
    ? captureAssetThumbnail().catch((thumbnailError) => {
        warn("[SAVE] thumbnail capture skipped:", thumbnailError.message);
        return null;
      })
    : null;

  const prepared = await prepareManifestForWrite(assetName);
  if (!prepared) {
    return { ok: false, reason: "empty" };
  }

  if (thumbnailPromise) {
    const thumbnail = await thumbnailPromise;
    if (thumbnail?.cid) {
      prepared.manifest.thumbnail = prepared.manifest.thumbnail?.cid
        ? { ...prepared.manifest.thumbnail, cid: thumbnail.cid }
        : thumbnail;
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
    // Keep the in-memory manifest cache aligned with the active CID even when
    // no new version is written, so the next save/publish can skip the IPFS
    // round-trip entirely.
    assetState.set({
      currentManifest: tagManifestCid(
        prepared.manifest,
        assetState.get().activeAssetManifestCid
      ),
    });
    return {
      ok: false,
      reason: "no-changes",
      cid: prepared.prevCid,
      manifest: prepared.prevManifest,
    };
  }

  // On republish, snapshot the Nostr comment thread to IPFS first so the
  // archive CID is embedded in the manifest and it is written only once.
  // Snapshot failures are logged but never block the save.
  if (publishContext?.tokenId) {
    try {
      const archiveContext = {
        ...publishContext,
        assetId: prepared.manifest.asset_id,
      };
      const { cid: archiveCid } = await snapshotCommentsArchive(archiveContext);
      prepared.manifest.comments_archive_cid = archiveCid;
    } catch (archiveErr) {
      warn(`[SAVE] comments archive skipped: ${archiveErr.message}`);
    }
  }

  // Write manifest directly to IPFS - no backend middleman.
  // The browser already writes glTF buffers and textures this way.
  const cid = await writeJSONToIPFS(prepared.manifest, null, {
    type: prepared.manifest.type,
    assetId: prepared.manifest.asset_id,
  });

  assetState.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(prepared.manifest, cid),
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
