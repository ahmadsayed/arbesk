/**
 * Arbesk Manifest Chain Walker
 *
 * Shared logic for walking fractal manifest chains and classifying the CIDs
 * they reference. Used by:
 *   - `POST /api/v1/ipfs/unpin` (conservative: only asset-unique CIDs)
 *   - `POST /api/v1/ipfs/gc`     (reachability: every reachable CID)
 *
 * The walker distinguishes two buckets:
 *   - `assetUnique` — CIDs that belong to the manifest chain itself and are
 *     safe to unpin when that chain is removed (manifest CIDs, thumbnails,
 *     comments archives for asset manifests).
 *   - `shared` — CIDs that may be referenced by other live tokens and must NOT
 *     be unpinned during ordinary delete/burn (source glTFs, bundle dirs,
 *     embedded buffers/images, and asset manifests referenced by collections).
 *
 * `allReachable` is the union of both buckets and is used by the GC job to
 * decide what is still alive.
 */

import { getStorage } from "./storage/index.js";
import { maybeDecompress, extractIpfsCids } from "./ipfs-utils.js";
import { getSceneNodes } from "./manifest-utils.js";

/**
 * @param {string} cid
 * @param {Set<string>} cids
 * @param {string[]} errors
 */
async function collectEmbeddedIpfsCids(cid, cids, errors) {
  if (!cid || cids.has(`__json_failed_${cid}`)) return;
  try {
    const raw = await getStorage().catBytes(cid);
    const decompressed = await maybeDecompress(raw);
    const json = JSON.parse(decompressed);
    extractIpfsCids(json, cids);
  } catch (e) {
    // Not a JSON object (e.g., raw buffer/image) - nothing to recurse into.
    errors.push(`read refs from ${cid}: ${(/** @type {Error} */ (e)).message}`);
  }
}

/**
 * Walk a manifest chain starting from `startCid` and classify referenced CIDs.
 *
 * @param {string} startCid
 * @param {object} [options]
 * @param {boolean} [options.recurseIntoSources=false] - For composite glTFs,
 *   also collect embedded buffer/image CIDs. Used by GC; unpin keeps this false
 *   to avoid deleting shared mesh/texture data.
 * @param {boolean} [options.recurseIntoCollectionAssets=false] - For collection
 *   manifests, recurse into each `assets[assetId]` manifest chain. Used by GC.
 * @param {number} [options.maxDepth=100] - Maximum manifests to walk per chain.
 * @returns {Promise<{
 *   visited: Set<string>,
 *   assetUnique: Set<string>,
 *   shared: Set<string>,
 *   allReachable: Set<string>,
 *   errors: string[]
 * }>}
 */
export async function walkManifestChain(startCid, options = {}) {
  const {
    recurseIntoSources = false,
    recurseIntoCollectionAssets = false,
    maxDepth = 100,
  } = options;

  const visited = new Set();
  const assetUnique = new Set();
  const shared = new Set();
  const allReachable = new Set();
  /** @type {string[]} */
  const errors = [];

  await walkSingleChain(startCid, {
    recurseIntoSources,
    recurseIntoCollectionAssets,
    maxDepth,
    visited,
    assetUnique,
    shared,
    allReachable,
    errors,
  });

  return { visited, assetUnique, shared, allReachable, errors };
}

/**
 * @typedef {Object} WalkContext
 * @property {boolean} recurseIntoSources
 * @property {boolean} recurseIntoCollectionAssets
 * @property {number} maxDepth
 * @property {Set<string>} visited
 * @property {Set<string>} assetUnique
 * @property {Set<string>} shared
 * @property {Set<string>} allReachable
 * @property {string[]} errors
 */

/**
 * @param {string} startCid
 * @param {WalkContext} ctx
 */
async function walkSingleChain(startCid, ctx) {
  let currentCid = startCid;

  while (currentCid && ctx.visited.size < ctx.maxDepth) {
    if (ctx.visited.has(currentCid)) {
      break;
    }
    ctx.visited.add(currentCid);

    let manifest;
    try {
      const raw = await getStorage().catBytes(currentCid);
      const decompressed = await maybeDecompress(raw);
      manifest = JSON.parse(decompressed);
    } catch (e) {
      console.warn(`[WALK] cannot read ${currentCid}: ${(/** @type {Error} */ (e)).message}`);
      ctx.errors.push(`read ${currentCid}: ${(/** @type {Error} */ (e)).message}`);
      break;
    }

    const isCollection = manifest.type === "collection";

    // The manifest CID itself is unique to this chain.
    ctx.assetUnique.add(currentCid);
    ctx.allReachable.add(currentCid);

    if (isCollection) {
      // Collection manifests map asset IDs to asset manifest CIDs. Those asset
      // manifests may be shared with other collections, so treat them as shared
      // unless the caller explicitly wants full reachability (GC mode).
      for (const assetCid of Object.values(manifest.assets || {})) {
        if (typeof assetCid !== "string" || !assetCid) continue;
        if (ctx.recurseIntoCollectionAssets) {
          await walkSingleChain(assetCid, {
            ...ctx,
            recurseIntoCollectionAssets: false,
          });
        } else {
          ctx.shared.add(assetCid);
          ctx.allReachable.add(assetCid);
        }
      }
    } else {
      // Asset manifest: thumbnail and comments archive are unique to this asset.
      const thumbnailCid = manifest?.thumbnail?.cid;
      if (thumbnailCid && typeof thumbnailCid === "string") {
        ctx.assetUnique.add(thumbnailCid);
        ctx.allReachable.add(thumbnailCid);
      }

      const commentsArchiveCid = manifest?.comments_archive_cid;
      if (commentsArchiveCid && typeof commentsArchiveCid === "string") {
        ctx.assetUnique.add(commentsArchiveCid);
        ctx.allReachable.add(commentsArchiveCid);
      }

      // Source asset CIDs (current + history) are potentially shared via dedup.
      const nodes = getSceneNodes(manifest);
      for (const node of nodes) {
        if (node?.source?.cid && typeof node.source.cid === "string") {
          ctx.shared.add(node.source.cid);
          ctx.allReachable.add(node.source.cid);
          if (ctx.recurseIntoSources) {
            await collectEmbeddedIpfsCids(
              node.source.cid,
              ctx.allReachable,
              ctx.errors,
            );
          }
        }
        if (
          node?.source?.bundleCid &&
          typeof node.source.bundleCid === "string"
        ) {
          ctx.shared.add(node.source.bundleCid);
          ctx.allReachable.add(node.source.bundleCid);
        }

        if (Array.isArray(node?.history)) {
          for (const entry of node.history) {
            if (entry?.src?.cid && typeof entry.src.cid === "string") {
              ctx.shared.add(entry.src.cid);
              ctx.allReachable.add(entry.src.cid);
              if (ctx.recurseIntoSources) {
                await collectEmbeddedIpfsCids(
                  entry.src.cid,
                  ctx.allReachable,
                  ctx.errors,
                );
              }
            }
            if (
              entry?.src?.bundleCid &&
              typeof entry.src.bundleCid === "string"
            ) {
              ctx.shared.add(entry.src.bundleCid);
              ctx.allReachable.add(entry.src.bundleCid);
            }
          }
        }
      }
    }

    currentCid = manifest.prev_asset_manifest_cid || null;
  }
}
