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
import { maybeDecompress, extractCidRefs } from "./ipfs-utils.ts";
import { getSceneNodes, validateManifest } from "./manifest-utils.ts";
import { isCompressedHead, sniffSourceKind } from "./source-sniff.ts";

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
 * What a document's first bytes say about downloading it in full.
 * - "binary": a GLB or 3MF zip - refers to nothing (cacheable).
 * - "leaf": a followed reference whose uncompressed first bytes cannot start
 *   a JSON object or array (an image, a .bin buffer) - refers to nothing
 *   (cacheable: the bytes behind a CID never change).
 * - "skip": a followed reference that is compressed and not recognisably
 *   JSON - treated as referring to nothing this run, but not cached.
 * - "download": anything else, including a failed peek (a 429 or 5xx must
 *   not make a pinned file unreadable when a full download could succeed).
 * Without catHead, everything is downloaded.
 */
async function triage(
  cid: string,
  storage: StorageAdapter,
  mustRead: boolean,
): Promise<"binary" | "leaf" | "skip" | "download"> {
  if (!storage.catHead) return "download";
  let head: Uint8Array;
  try {
    head = await storage.catHead(cid, SOURCE_SNIFF_BYTES);
  } catch {
    return "download";
  }
  const kind = sniffSourceKind(head);
  if (kind === "binary") return "binary";
  if (kind === "json" || mustRead) return "download";
  return isCompressedHead(head) ? "skip" : "leaf";
}

/**
 * The CIDs a document refers to, in any form (see extractCidRefs).
 * @param mustRead true for a node source: anything not positively binary is
 *   downloaded in full, as before. false for a followed reference: only a
 *   document whose first bytes are JSON is downloaded - an image or other
 *   unrecognised file is not, and refers to nothing.
 * @returns the references, or null when the document could not be read
 * @remarks A collection manifest reached this way refers to nothing: only
 *   the walk's own collection tip lists live assets (see WalkOptions).
 */
async function readRefs(
  cid: string,
  ctx: WalkContext,
  storage: StorageAdapter,
  mustRead: boolean,
): Promise<string[] | null> {
  const cached = ctx.sourceRefCache?.get(cid);
  if (cached) return cached;
  const verdict = await triage(cid, storage, mustRead);
  if (verdict === "binary" || verdict === "leaf") {
    ctx.sourceRefCache?.set(cid, []);
    return [];
  }
  // Not cached: a misread compressed prefix must not hide a JSON document for good.
  if (verdict === "skip") return [];
  let text: string;
  try {
    text = await maybeDecompress(await storage.catBytes(cid));
  } catch {
    return null;
  }
  const refs = parseRefs(cid, text);
  ctx.sourceRefCache?.set(cid, refs);
  return refs;
}

/** The references in a downloaded document; none if it is not JSON. */
function parseRefs(cid: string, text: string): string[] {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (binary GLB, 3MF, image) - no references.
    return [];
  }
  const refs = new Set<string>();
  if (json?.type !== "collection") extractCidRefs(json, refs);
  refs.delete(cid);
  // A followed manifest (a fork's source) needs its current version only:
  // its own history is kept by its own chain while that chain is live.
  if (typeof json?.prev_asset_manifest_cid === "string") refs.delete(json.prev_asset_manifest_cid);
  return [...refs];
}

/**
 * GC mode: marks `refs` reachable and follows each into the documents it
 * names, until nothing new turns up (a fork's manifest, a 3MF composite's
 * parts, a CAD design document).
 * @remarks A reference that cannot be read is an error only when it is
 *   pinned (or pin status is unknown): a file that is not ours to unpin
 *   cannot hide anything we might unpin.
 */
async function followRefs(
  refs: Iterable<string>,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  const queue = [...refs];
  while (queue.length) {
    const cid = queue.pop()!;
    if (ctx.followed.has(cid)) continue;
    ctx.followed.add(cid);
    ctx.allReachable.add(cid);
    const next = await readRefs(cid, ctx, storage, false);
    if (next === null) {
      if (!ctx.isPinned || ctx.isPinned(cid)) ctx.errors.push(`read refs from ${cid}: unreadable`);
      continue;
    }
    for (const ref of next) if (!ctx.followed.has(ref)) queue.push(ref);
  }
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
  /** With recurseIntoSources: whether a CID is pinned, so an unreadable
   * reference that is not pinned is skipped instead of failing the walk. */
  isPinned?: (cid: string) => boolean;
  /** With recurseIntoSources: what earlier walks of the same GC run have
   * already followed and read, so content shared between tokens is handled
   * once per run. Their reachable CIDs are in those walks' results. */
  runState?: GCWalkRunState;
}

/** Shared by the walks of one GC run (see WalkOptions.runState). */
export interface GCWalkRunState {
  followed: Set<string>;
  sourcesRead: Set<string>;
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
    isPinned,
    runState = { followed: new Set<string>(), sourcesRead: new Set<string>() },
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
    isPinned,
    followed: runState.followed,
    sourcesRead: runState.sourcesRead,
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
  isPinned?: (cid: string) => boolean;
  /** GC mode: references already followed in this run. */
  followed: Set<string>;
  /** GC mode: node sources already read strictly in this run. */
  sourcesRead: Set<string>;
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

/**
 * GC mode: reads a node source (in full unless it is a binary) and follows
 * what it refers to.
 * @remarks An unreadable source's references are unknown, so it is an
 *   error and GC must not trust the reachable set.
 */
async function followNodeSource(
  cid: string,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  if (ctx.sourcesRead.has(cid)) return;
  ctx.sourcesRead.add(cid);
  ctx.followed.add(cid);
  const refs = await readRefs(cid, ctx, storage, true);
  if (refs === null) ctx.errors.push(`read refs from ${cid}: unreadable`);
  else await followRefs(refs, ctx, storage);
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
    if (ctx.recurseIntoSources) await followNodeSource(node.source.cid, ctx, storage);
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

/**
 * GC mode: follows every CID an asset manifest names, in any field or form,
 * beyond the fields processAssetManifest knows (a fork's source manifest,
 * a composite listed directly as a collection entry by `besk upload`).
 * @remarks prev_asset_manifest_cid is left to the chain walk.
 */
async function followManifestRefs(
  manifest: any,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  const refs = new Set<string>();
  extractCidRefs(manifest, refs);
  refs.delete(manifest.prev_asset_manifest_cid);
  for (const cid of leafCids(manifest)) {
    ctx.followed.add(cid);
    refs.delete(cid);
  }
  await followRefs(refs, ctx, storage);
}

/**
 * The CIDs of an asset manifest's files that never refer to other files -
 * thumbnail, comments archive (Nostr events, free text), representations,
 * reference images, bundle directory - which processAssetManifest already
 * keeps. Not opened: a directory cannot be read as a file, and free text
 * must not keep pasted CIDs pinned.
 */
function leafCids(manifest: any): string[] {
  const nodes = getSceneNodes(manifest);
  const cids: unknown[] = [
    manifest?.thumbnail?.cid,
    manifest?.comments_archive_cid,
    ...listOf(manifest?.representations).map(cidField),
    ...nodes.map((node) => node?.source?.bundleCid),
    ...nodes.map((node) => node?.reference_image?.cid),
    ...nodes.flatMap((node) => listOf(node?.reference_images).map(cidField)),
  ];
  return cids.filter(isCid);
}

const listOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const cidField = (entry: any): unknown => entry?.cid;
const isCid = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Collects what one manifest of a chain refers to, by its type. */
async function processManifest(
  manifest: any,
  isChainTip: boolean,
  ctx: WalkContext,
  storage: StorageAdapter,
): Promise<void> {
  if (manifest.type === "collection") {
    await processCollectionManifest(manifest, isChainTip, ctx, storage);
    return;
  }
  await processAssetManifest(manifest, ctx, storage);
  if (ctx.recurseIntoSources) await followManifestRefs(manifest, ctx, storage);
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

    // The manifest CID itself is unique to this chain.
    ctx.assetUnique.add(currentCid);
    ctx.allReachable.add(currentCid);

    await processManifest(manifest, depth === 1, ctx, storage);

    currentCid = manifest.prev_asset_manifest_cid || null;
  }
}
