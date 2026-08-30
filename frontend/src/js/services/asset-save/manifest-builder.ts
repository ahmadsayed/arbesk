/**
 * Manifest construction helpers for save/publish.
 *
 * Handles loading the current manifest, applying pending edits (child refs,
 * source colors, post-processor colors, transforms), decomposing monolithic
 * glTF nodes, versioning the manifest chain, and writing the final manifest
 * to IPFS.
 */

import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import { computeAssetStats } from "./metadata-extract.ts";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.ts";
import { snapshotCommentsArchive } from "../api.ts";
import { getTokenURI } from "../token.ts";
import { getPendingChildRefs } from "../../engine/scene-graph.ts";
import { waitForPendingLinkedDrops } from "../../engine/scene-graph.ts";
import { waitForPendingFileDrops } from "../asset-file-drop.ts";
import { resolveFormatHandler } from "../../formats/index.ts";
import { buildDedupMap } from "@arbesk/asset-core/formats/gltf/dedup.js";
import {
  getPendingSourceColorEdits,
  clearPendingSourceColorEdits,
} from "../../engine/parametric-preview.ts";
import {
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  getPendingTransformEdits,
  clearPendingTransformEdits,
  clearPendingChildRefs,
  getPendingChildRefRemovals,
  clearPendingChildRefRemovals,
  getPendingSourceOverrides,
  clearPendingSourceOverrides,
  captureAssetThumbnail,
} from "../../engine/scene-graph.ts";
import {
  cacheCurrentManifest,
  recordSavedVersion,
  getActiveAssetManifestCid,
  getLatestAssetManifestCid,
  getActiveAssetTokenId,
  getCurrentManifest,
} from "@arbesk/asset-core/domain/asset.js";
import {
  listPendingGenerations,
  updatePendingGeneration,
} from "../../state/pending-generations.ts";
import { log, warn } from "../../utils/log.ts";
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";

/** @param {any} err */
function isRateLimitError(err: any) {
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
/** @param {string|null} activeCid */
function _useCachedManifest(activeCid: string | null) {
  if (!activeCid) return null;
  const cached = getCurrentManifest() as any;
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
/** @param {any} node */
function looksStored(node: any) {
  if (!node.source?.cid || node.child_ref) return false;
  if (_verifiedCompositeCids.has(node.source.cid)) return true;
  return resolveFormatHandler(node.source).isStoredForm(node);
}

/**
 * @param {any} manifest
 * @param {string|null} latestCid
 */
export function advanceManifestVersion(manifest: any, latestCid: string | null) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.prev_asset_manifest_cid =
    latestCid || getActiveAssetManifestCid() || null;
}

/**
 * Compare two manifests for semantic equality, ignoring auto-generated fields.
 */
/**
 * @param {any} a
 * @param {any} b
 */
export function manifestsSemanticallyEqual(a: any, b: any) {
  if (!a || !b) return false;
  const strip = (m: any) => {
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
 * @param {any} node
 * @param {any} manifest
 * @param {Map<string,string>|null} [dedupMap]
 * @param {Map<string,any>|null} [pendingColorEdits] - Source-color edits still to be
 *   applied. When a node has a pending edit we cannot take the fast path,
 *   because baking colors into a GLB produces a monolithic glTF that still
 *   carries the "composite.gltf" path marker and needs one more decomposition.
 */
async function _decomposeOneNode(
  node: any,
  manifest: any,
  dedupMap: Map<string, string> | null = null,
  pendingColorEdits: Map<string, any> | null = null
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
      dedupMap: (dedupMap as any),
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
      (err as Error).message
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
 * @param {any} manifest - The manifest being prepared for write
 * @param {Map<string,string>|null} [dedupMap]
 * @param {Map<string,any>|null} [pendingColorEdits]
 * @returns {Promise<number>} Count of nodes decomposed
 */
export async function decomposeManifestNodes(
  manifest: any,
  dedupMap: Map<string, string> | null = null,
  pendingColorEdits: Map<string, any> | null = null
) {
  const nodes = manifest.scene?.nodes || [];

  const jobs = nodes.map((node: any) =>
    _decomposeOneNode(node, manifest, dedupMap, pendingColorEdits)
  );

  const results = await Promise.allSettled(jobs);
  let decomposed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const node = nodes.find((n: any) => n.node_id === r.value.nodeId);
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
  if (getLatestAssetManifestCid()) {
    return getLatestAssetManifestCid();
  }

  const tokenId = getActiveAssetTokenId();
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
        (err as Error).message
      );
    }
  }
  return getActiveAssetManifestCid() || null;
}

/**
 * Build a hash → CID map from the composite glTFs referenced by one or more
 * asset manifests. Used to skip re-uploading unchanged buffers/images when
 * saving a new version.
 */
/** @param {any[]} manifests */
async function buildDedupMapFromManifests(manifests: any[]) {
  const composites = [];
  for (const manifest of manifests) {
    if (!manifest?.scene?.nodes) continue;
    const jobs = manifest.scene.nodes
      .filter(
        (n: any) =>
          n.source?.cid &&
          (resolveFormatHandler(n.source).isDedupSource?.(n) ?? false)
      )
      .map(async (n: any) => {
        try {
          return await getFromRemoteIPFS(n.source.cid);
        } catch (err) {
          warn(
            `Save: failed to fetch composite for dedup | cid=${n.source.cid}:`,
            (err as Error).message
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

/**
 * Collect chat provenance entries from pending-generation records sent to the
 * Studio since the last saved version, and mark them recorded so each prompt
 * lands in exactly one manifest version. Only records belonging to the active
 * manifest chain are consumed: sent records form a contiguous tail ending at
 * activeCid (a sent record's assetManifestCid becomes the active CID, and
 * later generations link back via prevAssetManifestCid).
 * @param {string|null|undefined} activeCid
 * @returns {Array<{prompt: string, provider: string, task: string, taskId?: string, timestamp: number}>}
 */
function collectChatProvenanceEntries(activeCid: string | null | undefined) {
  const candidates = listPendingGenerations().filter(
    (record) => record.status === "sent" && !record.recorded
  );

  // Walk the records' own/prev links outward from the active CID to find the
  // chain tail that belongs to this asset.
  const reachable = new Set((activeCid ? [activeCid] : []) as Array<string | null>);
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of candidates) {
      if (reachable.has(record.assetManifestCid)) {
        if (
          record.prevAssetManifestCid &&
          !reachable.has(record.prevAssetManifestCid)
        ) {
          reachable.add(record.prevAssetManifestCid);
          grew = true;
        }
      } else if (
        record.prevAssetManifestCid &&
        reachable.has(record.prevAssetManifestCid)
      ) {
        reachable.add(record.assetManifestCid);
        grew = true;
      }
    }
  }

  const entries = [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const record of candidates) {
    if (!reachable.has(record.assetManifestCid)) continue;
    entries.push({
      prompt: record.prompt,
      provider: record.provider || "mock",
      task: record.task || "model",
      ...(record.taskId && { taskId: record.taskId }),
      timestamp: nowSec,
    });
    updatePendingGeneration(record.id, { recorded: true });
  }
  return entries;
}

/**
 * Apply viewport gizmo transform edits.
 * Updates node.transform_matrix so the saved manifest renders the node
 * in its edited position/rotation/scale on next load.
 * @param {any} manifest
 * @param {Map<string, any>} pendingTransforms
 */
function applyTransformEdits(manifest: any, pendingTransforms: Map<string, any>) {
  if (pendingTransforms.size === 0) return;
  for (const [nodeId, matrixArray] of pendingTransforms) {
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (!node) continue;
    node.transform_matrix = matrixArray;
    log(`Save: applied transform edit | node=${nodeId}`);
  }
}

/**
 * Bake pending viewport file-drop source overrides. Must happen after the
 * prevManifest snapshot so a drop-only save is not reported as "no changes".
 * An override replaces the node's source and resets its post_processor to
 * defaults — the old edits described the old geometry. When the node does not
 * exist yet (fresh draft created by a drop with no asset open), a new single
 * node is appended.
 * @param {any} manifest
 * @param {Map<string, any>} pendingOverrides
 */
function applySourceOverrides(manifest: any, pendingOverrides: Map<string, any>) {
  if (pendingOverrides.size === 0) return;
  for (const [nodeId, override] of pendingOverrides) {
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (node) {
      node.source = { ...override.source };
      node.post_processor = {
        color: null,
        scale: { x: 1, y: 1, z: 1 },
      };
      log(`Save: applied source override | node=${nodeId}`);
    } else {
      manifest.scene.nodes.push({
        node_id: nodeId,
        type: "source_asset",
        name: override.name,
        source: { ...override.source },
        transform_matrix: identityMatrix(),
        post_processor: {
          color: null,
          scale: { x: 1, y: 1, z: 1 },
        },
      });
      log(`Save: created node from source override | node=${nodeId}`);
    }
  }
}

/**
 * Bake pending linked-child refs into the manifest, then drop child assets the
 * user unlinked this session. Both MUST happen after the prevManifest snapshot
 * so a "link/remove child → Save" on an otherwise unchanged draft is detected
 * as a change and written.
 * @param {any} manifest
 * @param {any[]} pendingRefs
 */
function applyPendingChildRefs(manifest: any, pendingRefs: any[]) {
  for (const pendingNode of pendingRefs) {
    if (!manifest.scene.nodes.some((n: any) => n.node_id === pendingNode.node_id)) {
      manifest.scene.nodes.push(pendingNode);
    }
  }
  const pendingRemovals = getPendingChildRefRemovals();
  if (pendingRemovals.size > 0) {
    manifest.scene.nodes = manifest.scene.nodes.filter(
      (n: any) => !pendingRemovals.has(n.node_id)
    );
  }
}

/**
 * Build the async bake job for a single node's source-color edit.
 * @param {any} node
 * @param {string} nodeId
 * @param {Record<string, string>} colorMap
 * @param {any} manifest
 * @param {Map<string, string>} dedupMap
 */
function buildSourceColorJob(
  node: any,
  nodeId: string,
  colorMap: Record<string, string>,
  manifest: any,
  dedupMap: Map<string, string>
) {
  return (async () => {
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
        (err as Error).message
      );
      return null;
    }
  })();
}

/**
 * Apply direct source color edits.
 * These mutate the source glTF/GLB asset and update node.source.cid.
 * Each node is independent, so bake them concurrently.
 * @param {any} manifest
 * @param {Map<string, any>} pendingColors - nodeId → (meshName → color)
 * @param {Map<string, string>} dedupMap
 */
async function applySourceColorEdits(
  manifest: any,
  pendingColors: Map<string, any>,
  dedupMap: Map<string, string>
) {
  if (pendingColors.size === 0) return;

  const colorJobs = [];
  for (const [nodeId, nodeEdits] of pendingColors) {
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (!node || !node.source?.cid) continue;

    const colorMap: Record<string, string> = {};
    for (const [meshName, color] of nodeEdits) {
      colorMap[meshName] = color;
    }

    colorJobs.push(
      buildSourceColorJob(node, nodeId, colorMap, manifest, dedupMap)
    );
  }

  const colorResults = await Promise.allSettled(colorJobs);
  for (const r of colorResults) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { nodeId, result } = r.value;
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
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

/**
 * Store a post-processor edit as a runtime overlay on a monolithic node.
 * @param {any} node
 * @param {any} pp
 */
function applyPostProcessorOverlay(node: any, pp: any) {
  node.post_processor ||= {};
  if (pp.color !== undefined) node.post_processor.color = pp.color;
  if (pp.scale !== undefined) node.post_processor.scale = { ...pp.scale };
  if (pp.meshOverrides && Object.keys(pp.meshOverrides).length > 0)
    node.post_processor.meshOverrides = { ...pp.meshOverrides };
  else if (node.post_processor.meshOverrides)
    delete node.post_processor.meshOverrides;
}

/**
 * Apply a composite post-processor bake result: update node.source.cid and
 * reconcile the node's post_processor scale overlay.
 * @param {any} node
 * @param {any} pp
 * @param {any} result
 */
function applyCompositeBakeResult(node: any, pp: any, result: any) {
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

/**
 * Build the async composite-color bake job for a decomposed node.
 * @param {any} node
 * @param {string} nodeId
 * @param {any} pp
 * @param {any} manifest
 */
function buildCompositeBakeJob(node: any, nodeId: string, pp: any, manifest: any) {
  return (async () => {
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
        (err as Error).message
      );
    }
    return { nodeId, pp, result };
  })();
}

/**
 * Apply post-processor edits.
 * Decomposed nodes: bake colors directly into the composite glTF.
 * Monolithic nodes: store as node.post_processor (runtime overlay).
 * @param {any} manifest
 * @param {Map<string, any>} pendingPP - nodeId → edit payload
 */
async function applyPostProcessorEdits(manifest: any, pendingPP: Map<string, any>) {
  if (pendingPP.size === 0) return;

  const ppJobs = [];
  for (const [nodeId, pp] of pendingPP) {
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (!node) continue;

    const isDecomposed =
      !!node.source?.cid && resolveFormatHandler(node.source).isStoredForm(node);

    // Handlers without a composite color bake (e.g. 3MF, which keeps edits
    // as overlays by design) must take the overlay branch even in stored
    // form — otherwise the null bake result silently drops the edit.
    const canBakeCompositeColors =
      isDecomposed &&
      typeof resolveFormatHandler(node.source).editCompositeColors ===
        "function";

    if (canBakeCompositeColors && (pp.color || pp.meshOverrides)) {
      // Decomposed nodes need an async composite bake. Capture the node id
      // and the edit payload so we can apply the result later.
      ppJobs.push(buildCompositeBakeJob(node, nodeId, pp, manifest));
    } else {
      // Monolithic node - store as post_processor overlay (also covers
      // decomposed nodes with only scale edits, which don't need a fetch).
      applyPostProcessorOverlay(node, pp);
    }
  }

  const ppResults = await Promise.allSettled(ppJobs);
  for (const r of ppResults) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { nodeId, pp, result } = r.value;
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (!node) continue;

    applyCompositeBakeResult(node, pp, result);
  }

  log(`Save: applied ${pendingPP.size} pending post-processor edit(s)`);
}

/**
 * Finalize versioning and chat provenance.
 * @param {any} manifest
 * @param {any} prevManifest
 * @param {string|null} latestCid
 * @param {string|null|undefined} activeCid
 */
function finalizeVersionAndChat(
  manifest: any,
  prevManifest: any,
  latestCid: string | null,
  activeCid: string | null | undefined
) {
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

  // Chat provenance is version-scoped: drop entries carried over from the
  // previous version, then record prompts consumed since that version.
  if (manifest.metadata) delete manifest.metadata.chat;
  const chatEntries = collectChatProvenanceEntries(activeCid);
  if (chatEntries.length > 0) {
    manifest.metadata = { ...(manifest.metadata || {}), chat: chatEntries };
  } else if (manifest.metadata && Object.keys(manifest.metadata).length === 0) {
    delete manifest.metadata;
  }
}

/**
 * @param {string} assetName
 */
/**
 * Gather pending edits and load (or build) the base manifest for a save.
 * Returns null when there is no asset open and nothing to save.
 * @param {string} assetName
 */
async function loadOrBuildBaseManifest(assetName: string) {
  // A linked-asset drop is fire-and-forget: if the user hits Save/Publish
  // while the drop is still resolving, its node is not in pendingChildRefs
  // yet and would be silently lost. Wait for any in-flight drops first.
  await waitForPendingLinkedDrops();
  await waitForPendingFileDrops();
  const pendingRefs = getPendingChildRefs();
  const pendingPP = getPendingPostProcessorEdits();
  const pendingTransforms = getPendingTransformEdits();
  const pendingColors = getPendingSourceColorEdits();
  const pendingOverrides = getPendingSourceOverrides();

  const activeCid = getActiveAssetManifestCid();
  let manifest;
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
    pendingColors.size > 0 ||
    pendingOverrides.size > 0
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
      `Save: creating fresh manifest for ${pendingRefs.length} pending child refs / ${pendingPP.size} pending post-processor edits / ${pendingTransforms.size} pending transform edits / ${pendingColors.size} pending source color edits / ${pendingOverrides.size} pending source overrides`
    );
  } else {
    return null;
  }

  return {
    manifest,
    activeCid,
    pendingRefs,
    pendingPP,
    pendingTransforms,
    pendingColors,
    pendingOverrides,
  };
}

export async function prepareManifestForWrite(assetName: string) {
  const loaded = await loadOrBuildBaseManifest(assetName);
  if (!loaded) return null;
  const {
    manifest,
    activeCid,
    pendingRefs,
    pendingPP,
    pendingTransforms,
    pendingColors,
    pendingOverrides,
  } = loaded;

  manifest.name = assetName;
  manifest.asset_id ||= `asset_${Date.now()}`;
  // Always refresh the timestamp so every saved/published version is a
  // distinct IPFS object. This prevents Pinata (and other backends that
  // reject exact duplicates) from returning a 409 when a manifest is saved
  // again without semantic changes.
  manifest.timestamp = Date.now();
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];

  // Resolve the previous manifest(s) for versioning and, when needed, build a
  // hash→CID map for component deduplication. Reuse the already-loaded active
  // manifest as the base; only fetch the latest chain tip when it differs.
  const latestCid = await resolveLatestManifestCid();
  log(
    `Save: versioning base | active=${activeCid} latest=${
      getLatestAssetManifestCid()
    } onChain=${
      getActiveAssetTokenId() || "none"
    } chosenPrev=${latestCid}`
  );

  const baseManifest = manifest;
  // prevManifest is the versioning + no-op-detection baseline. It MUST be a
  // snapshot of the manifest as it is now — before pending child refs are
  // baked in below and before decomposeManifestNodes() mutates `manifest` in
  // place. Aliasing the live manifest here makes the
  // later manifestsSemanticallyEqual() check compare the manifest against
  // itself, so every first save of a fresh draft (latestCid === activeCid) is
  // wrongly reported as "no changes" and never written. Fetch the distinct chain
  // tip when it differs; otherwise clone the current manifest.
  const prevManifest =
    latestCid && latestCid !== activeCid
      ? (await getFromRemoteIPFS(latestCid).catch(() => null)) ||
        JSON.parse(JSON.stringify(baseManifest))
      : JSON.parse(JSON.stringify(baseManifest));

  // Bake pending linked-child refs, then drop unlinked child assets.
  applyPendingChildRefs(manifest, pendingRefs as any[]);

  // Bake pending viewport file-drop source overrides.
  applySourceOverrides(manifest, pendingOverrides);

  const sourceNodes = manifest.scene.nodes.filter(
    (n: any) => n.source?.cid && !n.child_ref
  );
  const needsDedup =
    pendingColors.size > 0 || sourceNodes.some((n: any) => !looksStored(n));

  const dedupMap = needsDedup
    ? await buildDedupMapFromManifests(
        [baseManifest, prevManifest].filter(Boolean)
      )
    : new Map();
  log(`Save: dedup map built | entries=${dedupMap.size} skipped=${!needsDedup}`);

  // Apply direct source color edits (mutate source glTF/GLB, update node.source.cid).
  await applySourceColorEdits(manifest, pendingColors, dedupMap);

  // Apply post-processor edits (decomposed bake / monolithic overlay).
  await applyPostProcessorEdits(manifest, pendingPP);

  // Apply viewport gizmo transform edits.
  applyTransformEdits(manifest, pendingTransforms);

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

  // Recompute deterministic model facts (metadata.computed) from the root
  // source. Best-effort: a failure must never block the save.
  const computedStats = await computeAssetStats(manifest);
  if (computedStats) {
    manifest.metadata ||= {};
    manifest.metadata.computed = computedStats;
  }

  // Finalize version bump + version-scoped chat provenance.
  finalizeVersionAndChat(manifest, prevManifest, latestCid, activeCid);

  return {
    manifest,
    prevCid: latestCid,
    prevManifest: prevManifest || baseManifest,
  };
}

/**
 * @param {string} assetName
 * @param {{ captureThumbnail?: boolean, publishContext?: any }} [options]
 */
export async function saveAssetDraftCore(
  assetName: string,
  { captureThumbnail = false, publishContext = null }: { captureThumbnail?: boolean; publishContext?: any } = {}
) {
  // Thumbnail capture (canvas read + upload) is independent of manifest
  // preparation, so run both concurrently. Failures are non-fatal.
  const thumbnailPromise = captureThumbnail
    ? captureAssetThumbnail().catch((thumbnailError) => {
        warn("[SAVE] thumbnail capture skipped:", (thumbnailError as Error).message);
        return null;
      })
    : null;

  const prepared = await prepareManifestForWrite(assetName);
  if (!prepared) {
    return { ok: false, reason: "empty" };
  }

  if (thumbnailPromise) {
    const thumbnail = (await thumbnailPromise) as any;
    if (thumbnail?.cid) {
      prepared.manifest.thumbnail = prepared.manifest.thumbnail?.cid
        ? { ...prepared.manifest.thumbnail, cid: thumbnail.cid }
        : thumbnail;
    }
  }

  // metadata.chat is version-scoped: prepareManifestForWrite drops the
  // previous version's entries from the prepared manifest while prevManifest
  // (snapshotted before the drop) still carries them. Strip chat on the prev
  // side too — on a clone, since prevManifest is returned to the UI as the
  // no-op result manifest — so a no-change save after a chat-recording save
  // is not mistaken for a change. The prepared side is left intact: fresh
  // metadata.chat is precisely what forces the first save after "Show in
  // Studio" to write.
  const prevForDiff = prepared.prevManifest
    ? JSON.parse(JSON.stringify(prepared.prevManifest))
    : null;
  if (prevForDiff?.metadata) {
    delete prevForDiff.metadata.chat;
    if (Object.keys(prevForDiff.metadata).length === 0)
      delete prevForDiff.metadata;
  }

  if (
    prevForDiff &&
    manifestsSemanticallyEqual(prepared.manifest, prevForDiff)
  ) {
    // Pending edits are already reflected in the prepared manifest (otherwise
    // it would differ from the previous one). Clear them so the UI doesn't
    // keep trying to re-apply a settled state.
    clearPendingChildRefs();
    clearPendingChildRefRemovals();
    clearPendingPostProcessorEdits();
    clearPendingTransformEdits();
    clearPendingSourceColorEdits();
    clearPendingSourceOverrides();
    // Keep the in-memory manifest cache aligned with the active CID even when
    // no new version is written, so the next save/publish can skip the IPFS
    // round-trip entirely.
    cacheCurrentManifest(
      prepared.manifest,
      getActiveAssetManifestCid()
    );
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
      warn(`[SAVE] comments archive skipped: ${(archiveErr as Error).message}`);
    }
  }

  // Write manifest directly to IPFS - no backend middleman.
  // The browser already writes glTF buffers and textures this way.
  const cid = await writeJSONToIPFS(prepared.manifest, (null as any), {
    type: prepared.manifest.type,
    assetId: prepared.manifest.asset_id,
  });

  recordSavedVersion(cid, prepared.manifest);

  clearPendingChildRefs();
  clearPendingChildRefRemovals();
  clearPendingPostProcessorEdits();
  clearPendingTransformEdits();
  clearPendingSourceColorEdits();
  clearPendingSourceOverrides();

  return {
    ok: true,
    cid,
    manifest: prepared.manifest,
    prevCid: prepared.prevCid,
  };
}
