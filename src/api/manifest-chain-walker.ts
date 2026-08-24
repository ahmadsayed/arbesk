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

import type { StorageAdapter } from "./storage/index.ts";
import { maybeDecompress, extractIpfsCids } from "./ipfs-utils.ts";
import { getSceneNodes, validateManifest } from "./manifest-utils.ts";

async function collectEmbeddedIpfsCids(
  cid: string,
  cids: Set<string>,
  errors: string[],
  storage: StorageAdapter,
): Promise<void> {
  if (!cid || cids.has(`__json_failed_${cid}`)) return;
  try {
    const raw = await storage.catBytes(cid);
    const decompressed = await maybeDecompress(raw);
    const json = JSON.parse(decompressed);
    extractIpfsCids(json, cids);
  } catch (e) {
    // Not a JSON object (e.g., raw buffer/image) - nothing to recurse into.
    errors.push(`read refs from ${cid}: ${(e as Error).message}`);
  }
}

export interface WalkOptions {
  /** For composite glTFs, also collect embedded buffer/image CIDs. Used by GC;
   * unpin keeps this false to avoid deleting shared mesh/texture data. */
  recurseIntoSources?: boolean;
  /** For collection manifests, recurse into each `assets[assetId]` manifest
   * chain. Used by GC. */
  recurseIntoCollectionAssets?: boolean;
  /** Maximum manifests to walk per chain. */
  maxDepth?: number;
}

export interface WalkResult {
  visited: Set<string>;
  assetUnique: Set<string>;
  shared: Set<string>;
  allReachable: Set<string>;
  errors: string[];
}

/**
 * Walk a manifest chain starting from `startCid` and classify referenced CIDs.
 */
export async function walkManifestChain(
  startCid: string,
  options: WalkOptions = {},
  storage: StorageAdapter,
): Promise<WalkResult> {
  const {
    recurseIntoSources = false,
    recurseIntoCollectionAssets = false,
    maxDepth = 100,
  } = options;

  const visited = new Set<string>();
  const assetUnique = new Set<string>();
  const shared = new Set<string>();
  const allReachable = new Set<string>();
  const errors: string[] = [];

  await walkSingleChain(startCid, {
    recurseIntoSources,
    recurseIntoCollectionAssets,
    maxDepth,
    visited,
    assetUnique,
    shared,
    allReachable,
    errors,
  }, storage);

  return { visited, assetUnique, shared, allReachable, errors };
}

export interface WalkContext {
  recurseIntoSources: boolean;
  recurseIntoCollectionAssets: boolean;
  maxDepth: number;
  visited: Set<string>;
  assetUnique: Set<string>;
  shared: Set<string>;
  allReachable: Set<string>;
  errors: string[];
}

async function walkSingleChain(
  startCid: string,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  let currentCid: string | null = startCid;

  while (currentCid && ctx.visited.size < ctx.maxDepth) {
    if (ctx.visited.has(currentCid)) {
      break;
    }
    ctx.visited.add(currentCid);

    let manifest: any;
    try {
      const raw = await storage.catBytes(currentCid);
      const decompressed = await maybeDecompress(raw);
      manifest = JSON.parse(decompressed);
    } catch (e) {
      console.warn(`[WALK] cannot read ${currentCid}: ${(e as Error).message}`);
      ctx.errors.push(`read ${currentCid}: ${(e as Error).message}`);
      break;
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.warn(
        `[WALK] ${currentCid} manifest validation warnings: ${validation.errors.join("; ")}`,
      );
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
          }, storage);
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

      // Source asset CIDs are potentially shared via dedup.
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
              storage,
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
      }
    }

    currentCid = manifest.prev_asset_manifest_cid || null;
  }
}
