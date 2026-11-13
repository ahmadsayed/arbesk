/**
 * Walks fractal manifest chains and classifies the CIDs they reference.
 * @remarks `assetUnique` CIDs (manifest chain, thumbnails, comments archives)
 *   are safe to unpin when the chain is removed; `shared` CIDs (source glTFs,
 *   bundle dirs, embedded buffers/images, representation files,
 *   collection-referenced manifests) may
 *   be referenced by other live tokens and must not be unpinned on
 *   delete/burn.
 * Used by the ipfs/unpin and ipfs/gc routes.
 */

import type { StorageAdapter } from "./storage/index.ts";
import { maybeDecompress, extractIpfsCids } from "./ipfs-utils.ts";
import { getSceneNodes, validateManifest } from "./manifest-utils.ts";
import { sniffSourceKind } from "./source-sniff.ts";

/** Bytes fetched to tell a binary source from a JSON one. */
const SOURCE_SNIFF_BYTES = 1024;

/**
 * What earlier walks learned about source files: CID → the IPFS CIDs it
 * references (empty for a binary GLB/3MF/image).
 * @remarks Content-addressed, so an entry never goes stale. Lets a walk skip
 *   downloading a source it has already read - the bulk of the bytes, since
 *   binary sources are read only to find they hold no references.
 */
export interface SourceRefCache {
  get(cid: string): string[] | undefined;
  set(cid: string, refs: string[]): void;
}

/**
 * True only when the source's first bytes show a binary (GLB, 3MF zip),
 * which references no other CIDs, so the rest need not be downloaded.
 * @remarks Any doubt - no catHead, a failed fetch, unrecognised bytes -
 *   answers false, and the caller reads the source in full as before.
 */
async function isBinarySource(cid: string, storage: StorageAdapter): Promise<boolean> {
  if (!storage.catHead) return false;
  try {
    return sniffSourceKind(await storage.catHead(cid, SOURCE_SNIFF_BYTES)) === "binary";
  } catch {
    return false;
  }
}

async function collectEmbeddedIpfsCids(
  cid: string,
  cids: Set<string>,
  errors: string[],
  storage: StorageAdapter,
  cache?: SourceRefCache,
): Promise<void> {
  if (!cid || cids.has(`__json_failed_${cid}`)) return;
  const cached = cache?.get(cid);
  if (cached) {
    for (const ref of cached) cids.add(ref);
    return;
  }
  if (await isBinarySource(cid, storage)) {
    cache?.set(cid, []);
    return;
  }
  let text: string;
  try {
    text = await maybeDecompress(await storage.catBytes(cid));
  } catch (e) {
    // Unreadable source: its embedded CIDs are unknown, so GC must not trust
    // the reachable set.
    errors.push(`read refs from ${cid}: ${(e as Error).message}`);
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (binary GLB, 3MF, image) - no embedded refs to collect.
    cache?.set(cid, []);
    return;
  }
  const refs = new Set<string>();
  extractIpfsCids(json, refs);
  cache?.set(cid, [...refs]);
  for (const ref of refs) cids.add(ref);
}

export interface WalkOptions {
  /** For composite glTFs, also collect embedded buffer/image CIDs (unpin keeps
   * this false to avoid deleting shared mesh/texture data). */
  recurseIntoSources?: boolean;
  /** GC mode: recurse into the `assets[assetId]` manifest chains of the
   * chain tip only. Older collection versions contribute just their own
   * manifest CID, so an asset removed from the collection stops being
   * reachable through it (a fork's own chain still reaches the versions it
   * shares). */
  recurseIntoCollectionAssets?: boolean;
  /** Maximum manifests to walk per chain (each collection asset's chain
   * gets its own budget). Hitting it records an error. */
  maxDepth?: number;
  /** With recurseIntoSources: source refs already known, consulted before
   * downloading a source and filled with each one read. */
  sourceRefCache?: SourceRefCache;
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
    sourceRefCache,
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
    sourceRefCache,
    visited,
    assetUnique,
    shared,
    allReachable,
    errors,
  }, storage);

  return { visited, assetUnique, shared, allReachable, errors };
}

interface WalkContext {
  recurseIntoSources: boolean;
  recurseIntoCollectionAssets: boolean;
  maxDepth: number;
  sourceRefCache?: SourceRefCache;
  visited: Set<string>;
  assetUnique: Set<string>;
  shared: Set<string>;
  allReachable: Set<string>;
  errors: string[];
}

async function readManifest(
  cid: string,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<any | null> {
  try {
    const raw = await storage.catBytes(cid);
    const decompressed = await maybeDecompress(raw);
    return JSON.parse(decompressed);
  } catch (e) {
    console.warn(`[WALK] cannot read ${cid}: ${(e as Error).message}`);
    ctx.errors.push(`read ${cid}: ${(e as Error).message}`);
    return null;
  }
}

async function processCollectionManifest(
  manifest: any,
  isChainTip: boolean,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  // In GC mode only the tip lists the collection's current assets; an older
  // version may still list assets that were deleted since.
  if (ctx.recurseIntoCollectionAssets && !isChainTip) return;
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
}

async function processAssetManifest(
  manifest: any,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
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
    await addNodeSource(node, ctx, storage);
    addReferenceImages(node, ctx);
  }
  addRepresentations(manifest, ctx);
}

/**
 * Collects the files an asset's `representations` list records (a .blend,
 * an STL, a G-code).
 * @remarks Shared, not asset-unique: `send` forks share the manifest's list,
 *   and a re-attach of the same bytes dedups to the same CID. GC keeps them
 *   while any live chain lists them and reclaims them once none does.
 */
function addRepresentations(manifest: any, ctx: WalkContext): void {
  const list = Array.isArray(manifest?.representations) ? manifest.representations : [];
  for (const rep of list) {
    if (rep?.cid && typeof rep.cid === "string") {
      ctx.shared.add(rep.cid);
      ctx.allReachable.add(rep.cid);
    }
  }
}

/** Collects a node's source and bundle CIDs (shared via dedup). */
async function addNodeSource(
  node: any,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  if (node?.source?.cid && typeof node.source.cid === "string") {
    ctx.shared.add(node.source.cid);
    ctx.allReachable.add(node.source.cid);
    if (ctx.recurseIntoSources) {
      await collectEmbeddedIpfsCids(
        node.source.cid,
        ctx.allReachable,
        ctx.errors,
        storage,
        ctx.sourceRefCache,
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

/**
 * Collects a node's image-to-3D reference images (bare CIDs, not ipfs://
 * URIs).
 * @remarks Shared: a copied node carries the same reference image into
 *   another token.
 */
function addReferenceImages(node: any, ctx: WalkContext): void {
  const referenceImages = [
    node?.reference_image,
    ...(Array.isArray(node?.reference_images) ? node.reference_images : []),
  ];
  for (const image of referenceImages) {
    if (image?.cid && typeof image.cid === "string") {
      ctx.shared.add(image.cid);
      ctx.allReachable.add(image.cid);
    }
  }
}

async function walkSingleChain(
  startCid: string,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  let currentCid: string | null = startCid;
  // Per-chain budget: `visited` is shared with collection-asset walks, so
  // its size would cap the whole collection, not this chain.
  let depth = 0;

  while (currentCid) {
    if (ctx.visited.has(currentCid)) {
      break;
    }
    if (depth >= ctx.maxDepth) {
      ctx.errors.push(
        `chain from ${startCid} truncated at maxDepth=${ctx.maxDepth} (next ${currentCid})`,
      );
      break;
    }
    depth++;
    ctx.visited.add(currentCid);

    const manifest = await readManifest(currentCid, ctx, storage);
    if (!manifest) break;

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
      await processCollectionManifest(manifest, depth === 1, ctx, storage);
    } else {
      await processAssetManifest(manifest, ctx, storage);
    }

    currentCid = manifest.prev_asset_manifest_cid || null;
  }
}
