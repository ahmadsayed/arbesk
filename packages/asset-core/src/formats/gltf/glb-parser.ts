/**
 * Arbesk GLB Parser & Direct Decomposer
 *
 * Parses glTF 2.0 GLB files in the browser, extracts the JSON and binary
 * chunks, and directly produces a composite glTF whose buffers and images
 * reference separate IPFS CIDs.
 *
 * This avoids the base64 bloat of converting GLB → standard glTF first.
 */

import { WebIO, GLB_BUFFER } from "@gltf-transform/core";
import { getRuntime } from "../../runtime.ts";
import { sanitizeFileName, extractDataURI } from "../../utils/uri.ts";
import { extFromMimeType } from "./image-mime.ts";
import { resolveGlbImageBytes } from "./glb-image-resolve.ts";
import {
  uploadWithDedup,
  attachDedupMeta,
  ipfsUriFromCid,
} from "./dedup.ts";
import type { DedupMeta } from "./dedup.ts";
import type { UploadCredential } from "../../storage/ipfs/upload-with-credential.ts";

// serializeGLB lives in gltf-core.js (shared with the backend, which packs
// composed composites to GLB for Tripo uploads) — re-exported here so
// existing glb-parser consumers keep working.
export { serializeGLB } from "./gltf-core.ts";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const IPFS_URI_PREFIX = "ipfs://";

let _io: WebIO | null = null;
function getIO(): WebIO {
  if (!_io) _io = new WebIO();
  return _io;
}

/**
 * Check if an ArrayBuffer looks like a GLB v2 container.
 */
export function isGLB(arrayBuffer: ArrayBuffer): boolean {
  if (!arrayBuffer || arrayBuffer.byteLength < 12) return false;
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  return magic === GLB_MAGIC && version === GLB_VERSION;
}

/**
 * Parse a GLB v2 file.
 *
 * Uses @gltf-transform/core for spec-compliant container parsing. The legacy
 * custom DataView-based parser has been removed.
 */
export async function parseGLB(
  arrayBuffer: ArrayBuffer
): Promise<{ json: any; binaryChunk: ArrayBuffer | null }> {
  if (!arrayBuffer) throw new Error("parseGLB: arrayBuffer is required");
  if (arrayBuffer.byteLength < 12) {
    throw new Error("parseGLB: file too small to be a GLB");
  }

  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);

  if (magic !== GLB_MAGIC) {
    throw new Error(`parseGLB: invalid magic 0x${magic.toString(16)}`);
  }
  if (version !== GLB_VERSION) {
    throw new Error(`parseGLB: unsupported GLB version ${version}`);
  }

  const { json, resources } = await getIO().binaryToJSON(
    new Uint8Array(arrayBuffer)
  );
  const binBytes = resources[GLB_BUFFER];
  const binaryChunk = binBytes
    ? (
        binBytes.buffer.slice(
          binBytes.byteOffset,
          binBytes.byteOffset + binBytes.byteLength
        ) as ArrayBuffer
      )
    : null;

  return { json, binaryChunk };
}

type GlbWriter = (bytes: Uint8Array | string, filename: string) => Promise<string>;

/**
 * Write bytes to IPFS using the provided writer or the default project writer.
 * When no writer is supplied, the dedup-aware upload path is used so unchanged
 * components can reuse their previous CID.
 *
 * @param bytes - Raw bytes (a JSON string only when `writer` is supplied)
 */
async function writeBytes(
  writer: GlbWriter | null | undefined,
  bytes: Uint8Array | string,
  filename: string,
  credential: UploadCredential | null = null,
  options: { compress?: boolean } = {},
  dedupMap: Map<string, string> | null = null
): Promise<{ cid: string; meta: DedupMeta | null; skipped: boolean }> {
  if (writer) {
    const cid = await writer(bytes, filename);
    return { cid, meta: null, skipped: false };
  }
  // The string form only ever reaches the writer branch above; the default
  // path always receives Uint8Array component bytes.
  return uploadWithDedup(
    bytes as Uint8Array,
    filename,
    credential,
    options,
    dedupMap
  );
}

/**
 * Resolve a buffer URI to a Uint8Array.
 * @param buf - glTF buffer entry (dynamic schema)
 */
function resolveBufferBytes(
  buf: any,
  binaryChunk: ArrayBuffer | null
): Uint8Array | null {
  if (!buf.uri) {
    if (!binaryChunk) {
      throw new Error(
        "resolveBufferBytes: GLB buffer has no uri and no binary chunk"
      );
    }
    if (buf.byteLength && buf.byteLength !== binaryChunk.byteLength) {
      console.warn(
        `[GLB-PARSER] buffer.byteLength (${buf.byteLength}) != binary chunk length (${binaryChunk.byteLength}); using binary chunk length`
      );
    }
    return new Uint8Array(binaryChunk);
  }

  if (buf.uri.startsWith("data:")) {
    const extracted = extractDataURI(buf.uri);
    if (!extracted) {
      throw new Error("resolveBufferBytes: failed to extract data URI");
    }
    return extracted.bytes;
  }

  return null;
}

interface ImageRemoval {
  bufferIndex: number;
  oldBvIndex: number;
  start: number;
  end: number;
}

interface ImageUploadTask {
  index: number;
  img: any;
  bytes: Uint8Array;
  mimeType: string | null;
  removal: ImageRemoval | null;
}

interface DecomposeGLBOptions {
  /** When `storeComposite` is
   *   false, buffers/images are still uploaded but the composite glTF itself is
   *   not written to IPFS (`compositeCid` is null). Use this when the caller
   *   mutates the composite and writes its own final version. */
  storeComposite?: boolean;
  credential?: UploadCredential | null;
  compress?: boolean;
  assetName?: string;
  assetId?: string;
  dedupMap?: Map<string, string> | null;
}

interface DecomposeStats {
  buffers: number;
  images: number;
  bytesTotal: number;
  skipped: number;
}

/** Upload context shared by the parallel image/buffer upload tasks. */
interface UploadContext {
  writer: GlbWriter | null | undefined;
  baseName: string;
  credential: UploadCredential | null;
  compress: boolean;
  dedupMap: Map<string, string> | null;
  stats: DecomposeStats;
}

/**
 * Plan image extraction: resolve each image's bytes (data-URI or bufferView)
 * and MIME type, and record the buffer range a bufferView image can later be
 * pruned from. External/already-composite URIs are left as-is.
 */
function collectImageUploadTasks(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  stats: DecomposeStats
): ImageUploadTask[] {
  const images = composite.images || [];
  const tasks: ImageUploadTask[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];

    // External or already-composite URI
    if (img.uri && !img.uri.startsWith("data:")) {
      if (img.uri.startsWith(IPFS_URI_PREFIX)) {
        stats.images++;
      } else {
        console.log(`[GLB-DECOMPOSE] image[${i}] external URI, keeping as-is`);
      }
      continue;
    }

    const resolved = resolveGlbImageBytes(composite, bufferBytesByIndex, img, i, "[GLB-DECOMPOSE]");
    if (!resolved) continue;

    let removal: ImageRemoval | null = null;
    if (img.bufferView !== undefined) {
      const bv = composite.bufferViews[img.bufferView];
      removal = {
        bufferIndex: bv.buffer,
        oldBvIndex: img.bufferView,
        start: bv.byteOffset || 0,
        end: (bv.byteOffset || 0) + bv.byteLength,
      };
    }

    tasks.push({ index: i, img, bytes: resolved.bytes, mimeType: resolved.mimeType, removal });
  }
  return tasks;
}

/** Upload one extracted image and rewrite its entry to the new IPFS URI. */
async function uploadImageTask(
  { index, img, bytes, mimeType, removal }: ImageUploadTask,
  ctx: UploadContext,
  images: any[]
): Promise<ImageRemoval | null> {
  const ext = extFromMimeType(mimeType);
  const filename = `${ctx.baseName}_texture_${index}.${ext}`;
  const { cid, meta, skipped } = await writeBytes(
    ctx.writer,
    bytes,
    filename,
    ctx.credential,
    { compress: ctx.compress },
    ctx.dedupMap
  );
  let newImg = { ...img, uri: ipfsUriFromCid(cid) };
  if (meta) newImg = attachDedupMeta(newImg, meta);
  delete newImg.bufferView;
  if (mimeType && !newImg.mimeType) {
    newImg.mimeType = mimeType;
  }
  images[index] = newImg;
  ctx.stats.images++;
  ctx.stats.bytesTotal += bytes.length;
  if (skipped) ctx.stats.skipped++;
  console.log(
    `[GLB-DECOMPOSE] image[${index}] → ipfs://${cid} (${bytes.length} bytes)${
      skipped ? " [dedup]" : ""
    }`
  );
  return removal;
}

interface BufferUploadTask {
  index: number;
  buf: any;
  bytes: Uint8Array;
}

/** Collect the buffers that still need uploading (skip composite/external). */
function collectBufferUploadTasks(
  buffers: any[],
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  stats: DecomposeStats
): BufferUploadTask[] {
  const tasks: BufferUploadTask[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];

    // Already composite
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) {
      stats.buffers++;
      continue;
    }

    // External URI - keep as-is
    if (buf.uri && !buf.uri.startsWith("data:")) {
      console.log(`[GLB-DECOMPOSE] buffer[${i}] external URI, keeping as-is`);
      continue;
    }

    const bytes = bufferBytesByIndex[i];
    if (!bytes) {
      console.warn(
        `[GLB-DECOMPOSE] buffer[${i}] could not be resolved, skipping`
      );
      continue;
    }

    tasks.push({ index: i, buf, bytes });
  }
  return tasks;
}

/** Upload one buffer and rewrite its entry to the new IPFS URI. */
async function uploadBufferTask(
  { index, buf, bytes }: BufferUploadTask,
  ctx: UploadContext,
  buffers: any[]
): Promise<void> {
  const filename = `${ctx.baseName}_buffer_${index}.bin`;
  const { cid, meta, skipped } = await writeBytes(
    ctx.writer,
    bytes,
    filename,
    ctx.credential,
    { compress: ctx.compress },
    ctx.dedupMap
  );
  let updatedBuf = { ...buf, uri: ipfsUriFromCid(cid) };
  if (meta) updatedBuf = attachDedupMeta(updatedBuf, meta);
  buffers[index] = updatedBuf;
  ctx.stats.buffers++;
  ctx.stats.bytesTotal += bytes.length;
  if (skipped) ctx.stats.skipped++;
  console.log(
    `[GLB-DECOMPOSE] buffer[${index}] → ipfs://${cid} (${bytes.length} bytes)${
      skipped ? " [dedup]" : ""
    }`
  );
}

/**
 * Decompose a GLB in-memory into a composite glTF JSON with IPFS CID references.
 * This is the `decompose` half of the GLB FormatCodec (formats/codec.ts).
 *
 * @param arrayBuffer - Raw GLB bytes
 * @param writer - Optional IPFS writer `(bytes, filename) => Promise<cid>`
 */
export async function decompose(
  arrayBuffer: ArrayBuffer,
  writer?: GlbWriter | null,
  options: DecomposeGLBOptions = {}
): Promise<{ composite: any; compositeCid?: string }> {
  if (!arrayBuffer) throw new Error("decompose: arrayBuffer is required");
  const {
    storeComposite = true,
    credential = null,
    compress = true,
    assetName,
    assetId,
    dedupMap = null,
  } = options;

  const baseName = sanitizeFileName((assetName || assetId) as string);

  const { json, binaryChunk } = await parseGLB(arrayBuffer);
  const composite = JSON.parse(JSON.stringify(json));
  const stats: DecomposeStats = { buffers: 0, images: 0, bytesTotal: 0, skipped: 0 };

  // Resolve each buffer to bytes, but don't upload yet - images may be
  // extracted from bufferViews and pruned before the final buffer CID is written.
  const bufferBytesByIndex: Array<Uint8Array | undefined> = [];
  const buffers = composite.buffers || [];

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (
      buf.uri &&
      (buf.uri.startsWith(IPFS_URI_PREFIX) || !buf.uri.startsWith("data:"))
    ) {
      continue;
    }

    const bytes = resolveBufferBytes(buf, binaryChunk);
    if (bytes) {
      bufferBytesByIndex[i] = bytes;
    }
  }

  const uploadCtx: UploadContext = {
    writer,
    baseName,
    credential,
    compress,
    dedupMap,
    stats,
  };

  // Extract images to IPFS and record buffer ranges that can be pruned.
  // Planning is synchronous; the actual uploads run in parallel so GLBs with
  // many textures don't pay a serial upload penalty.
  const images = composite.images || [];
  const imageUploadTasks = collectImageUploadTasks(composite, bufferBytesByIndex, stats);
  const imageRemovals = await Promise.all(
    imageUploadTasks.map((task) => uploadImageTask(task, uploadCtx, images))
  );
  const imageRemovalsByBuffer = new Map<number, ImageRemoval[]>();
  for (const removal of imageRemovals) {
    if (!removal) continue;
    const list = imageRemovalsByBuffer.get(removal.bufferIndex) || [];
    list.push(removal);
    imageRemovalsByBuffer.set(removal.bufferIndex, list);
  }

  // Remove extracted image bytes from the buffer(s) so we don't store them twice.
  if (imageRemovalsByBuffer.size > 0) {
    pruneBufferImageData(composite, bufferBytesByIndex, imageRemovalsByBuffer);
  }

  // Upload buffers after pruning so the geometry payloads are consistent;
  // the uploads themselves can overlap.
  const bufferUploadTasks = collectBufferUploadTasks(buffers, bufferBytesByIndex, stats);
  await Promise.all(
    bufferUploadTasks.map((task) => uploadBufferTask(task, uploadCtx, buffers))
  );

  console.log(
    `[GLB-DECOMPOSE] done | buffers=${stats.buffers} images=${stats.images} skipped=${stats.skipped} totalBytes=${stats.bytesTotal}`
  );

  let compositeCid: string | undefined;
  if (storeComposite) {
    if (writer) {
      const result = await writeBytes(
        writer,
        JSON.stringify(composite),
        `${baseName}_composite.gltf`,
        null,
        { compress }
      );
      compositeCid = result.cid;
    } else {
      compositeCid = await getRuntime().ipfsWrite.writeJSON(composite, credential, {
        compress,
        assetId,
        filename: `${baseName}_composite.gltf`,
      });
    }
    console.log(`[GLB-DECOMPOSE] composite stored → ${compositeCid}`);
  } else {
    console.log(`[GLB-DECOMPOSE] composite not stored (caller writes its own)`);
  }

  return { composite, compositeCid };
}

interface ByteRange {
  start: number;
  end: number;
}

/**
 * bufferViews referenced by accessors (incl. sparse) or mesh extensions
 * (Draco) — pruning one of these would corrupt geometry.
 */
function collectReferencedBufferViews(composite: any): Set<number> {
  const referenced = new Set<number>();
  for (const acc of composite.accessors || []) {
    if (acc.bufferView !== undefined) referenced.add(acc.bufferView);
    if (acc.sparse?.indices?.bufferView !== undefined) {
      referenced.add(acc.sparse.indices.bufferView);
    }
    if (acc.sparse?.values?.bufferView !== undefined) {
      referenced.add(acc.sparse.values.bufferView);
    }
  }
  for (const mesh of composite.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const draco = prim.extensions?.KHR_draco_mesh_compression;
      if (draco?.bufferView !== undefined) referenced.add(draco.bufferView);
    }
  }
  return referenced;
}

/**
 * Rewrite every bufferView reference (accessors, sparse, Draco) through the
 * old→new index mapping after bufferViews were compacted.
 */
function renumberBufferViewRefs(composite: any, mapping: Map<number, number>): void {
  for (const acc of composite.accessors || []) {
    if (acc.bufferView !== undefined)
      acc.bufferView = mapping.get(acc.bufferView);
    if (acc.sparse?.indices?.bufferView !== undefined) {
      acc.sparse.indices.bufferView = mapping.get(
        acc.sparse.indices.bufferView
      );
    }
    if (acc.sparse?.values?.bufferView !== undefined) {
      acc.sparse.values.bufferView = mapping.get(acc.sparse.values.bufferView);
    }
  }
  for (const mesh of composite.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const draco = prim.extensions?.KHR_draco_mesh_compression;
      if (draco?.bufferView !== undefined) {
        draco.bufferView = mapping.get(draco.bufferView);
      }
    }
  }
}

/** Sort ranges by start and merge overlapping/adjacent ones. */
function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: ByteRange[] = [];
  for (const r of sorted) {
    if (merged.length === 0 || r.start > merged[merged.length - 1].end) {
      merged.push({ start: r.start, end: r.end });
    } else {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        r.end
      );
    }
  }
  return merged;
}

/**
 * True when any surviving bufferView of the given buffer overlaps one of the
 * ranges about to be pruned — the caller must abort the prune in that case.
 */
function anyRemainingViewOverlaps(
  composite: any,
  bufferIndex: number,
  ranges: ByteRange[]
): boolean {
  for (const bv of composite.bufferViews) {
    if (bv.buffer !== bufferIndex) continue;
    const start = bv.byteOffset || 0;
    const end = start + bv.byteLength;
    for (const r of ranges) {
      if (end <= r.start || start >= r.end) continue;
      return true;
    }
  }
  return false;
}

/** Build new buffer bytes with the given ranges excised. */
function spliceOutRanges(bytes: Uint8Array, ranges: ByteRange[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let last = 0;
  for (const r of ranges) {
    if (r.start > last) parts.push(bytes.subarray(last, r.start));
    last = r.end;
  }
  if (last < bytes.length) parts.push(bytes.subarray(last));

  const newBytes = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    newBytes.set(p, pos);
    pos += p.length;
  }
  return newBytes;
}

/** Shift surviving bufferViews' byteOffsets down past the excised ranges. */
function adjustBufferViewOffsets(
  composite: any,
  bufferIndex: number,
  ranges: ByteRange[]
): void {
  for (const bv of composite.bufferViews) {
    if (bv.buffer !== bufferIndex) continue;
    const oldOffset = bv.byteOffset || 0;
    let adjustment = 0;
    for (const r of ranges) {
      if (r.end <= oldOffset) adjustment += r.end - r.start;
    }
    bv.byteOffset = oldOffset - adjustment;
  }
}

/**
 * Remove image byte ranges from GLB buffers after the images have been extracted
 * to separate IPFS objects. Updates bufferViews, accessors, and buffer byteLength
 * so geometry data is preserved and we don't store the image bytes twice.
 *
 * @param composite - Composite glTF JSON being built (mutated; dynamic schema)
 * @param bufferBytesByIndex - Resolved buffer bytes (mutated)
 */
function pruneBufferImageData(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  removalsByBuffer: Map<number, ImageRemoval[]>
): void {
  const allRemovedIndices = new Set<number>();
  for (const list of removalsByBuffer.values()) {
    for (const r of list) allRemovedIndices.add(r.oldBvIndex);
  }

  const referenced = collectReferencedBufferViews(composite);
  const indicesToRemove = new Set<number>();
  for (const idx of allRemovedIndices) {
    if (referenced.has(idx)) {
      console.warn(
        `[GLB-DECOMPOSE] bufferView ${idx} is also referenced by accessors/extensions, not pruning`
      );
    } else {
      indicesToRemove.add(idx);
    }
  }

  if (indicesToRemove.size === 0) return;

  // Compact the bufferView array, remembering old→new indices.
  const oldBufferViews = composite.bufferViews || [];
  const newBufferViews: any[] = [];
  const mapping = new Map<number, number>();
  for (let i = 0; i < oldBufferViews.length; i++) {
    if (indicesToRemove.has(i)) continue;
    mapping.set(i, newBufferViews.length);
    newBufferViews.push(oldBufferViews[i]);
  }
  composite.bufferViews = newBufferViews;
  renumberBufferViewRefs(composite, mapping);

  for (const [bufferIndex, removals] of removalsByBuffer) {
    const bytes = bufferBytesByIndex[bufferIndex];
    if (!bytes) continue;

    const relevant = removals.filter((r) => indicesToRemove.has(r.oldBvIndex));
    if (relevant.length === 0) continue;

    const merged = mergeRanges(relevant);

    if (anyRemainingViewOverlaps(composite, bufferIndex, merged)) {
      console.warn(
        `[GLB-DECOMPOSE] buffer ${bufferIndex}: remaining bufferView overlaps pruned image range, aborting prune`
      );
      continue;
    }

    const newBytes = spliceOutRanges(bytes, merged);
    adjustBufferViewOffsets(composite, bufferIndex, merged);
    bufferBytesByIndex[bufferIndex] = newBytes;
    composite.buffers[bufferIndex].byteLength = newBytes.length;
  }
}
