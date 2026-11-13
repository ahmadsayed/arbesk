/**
 * Parses glTF 2.0 GLB files and directly produces a composite glTF whose
 * buffers and images reference separate IPFS CIDs.
 * @remarks This avoids the base64 bloat of converting GLB → standard glTF
 *   first.
 */

import { WebIO, GLB_BUFFER } from "@gltf-transform/core";
import { getRuntime } from "../../runtime-state.ts";
import { sanitizeFileName, extractDataURI } from "../../utils/uri.ts";
import { extFromMimeType } from "./image-mime.ts";
import { resolveGlbImageBytes } from "./glb-image-resolve.ts";
import { imageRemovalFor, pruneBufferImageData } from "./glb-image-prune.ts";
import type { ImageRemoval } from "./glb-image-prune.ts";
import {
  uploadWithDedup,
  attachDedupMeta,
  ipfsUriFromCid,
} from "./dedup.ts";
import type { DedupMeta } from "./dedup.ts";
import type { UploadCredential } from "../../storage/ipfs/upload-with-credential.ts";
import type { CompressOption } from "../../types.ts";

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
 * Parses a GLB v2 file.
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

  // The worker keeps a copy of this extraction (gltf-worker.ts decomposeGlb):
  // importing it there would drag in `@gltf-transform/core`, unresolvable in
  // the module worker. Intentional, documented in the worker's header.
  // fallow-ignore-next-line code-duplication
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
 * Writes bytes to IPFS via the provided writer or the default project writer.
 * @remarks With no writer, the dedup-aware upload path is used so unchanged
 *   components reuse their previous CID.
 * @param bytes - Raw bytes (a JSON string only when `writer` is supplied)
 */
async function writeBytes(
  writer: GlbWriter | null | undefined,
  bytes: Uint8Array | string,
  filename: string,
  credential: UploadCredential | null = null,
  options: { compress?: CompressOption } = {},
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
  compress?: CompressOption;
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
  compress: CompressOption;
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

    const removal = imageRemovalFor(composite, img);
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
 * Decomposes a GLB in-memory into a composite glTF JSON with IPFS CID refs.
 * @param arrayBuffer - Raw GLB bytes
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
  const uploaded = await Promise.all(
    imageUploadTasks.map((task) => uploadImageTask(task, uploadCtx, images))
  );
  const imageRemovals = uploaded.filter((r): r is ImageRemoval => r !== null);

  // Remove extracted image bytes from the buffer(s) so we don't store them twice.
  if (imageRemovals.length > 0) {
    pruneBufferImageData(composite, bufferBytesByIndex, imageRemovals, "[GLB-DECOMPOSE]");
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
