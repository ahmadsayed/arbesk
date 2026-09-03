/**
 * Offloads CPU/network-heavy glTF operations from the browser main thread:
 * composition, decomposition, GLB parsing/decomposition, and source color
 * baking.
 * @remarks The worker runs without the page's import map, so it only imports
 *   bare-free modules: every @arbesk/asset-core subpath must transitively
 *   avoid bare specifiers (fflate, @gltf-transform/core, …). The build
 *   rewrites the bare @arbesk/asset-core specifiers to relative vendor paths.
 */

import { WebIO, GLB_BUFFER } from "../vendor/gltf-transform-core-4.1.2.js";
import workerpool, { Transfer } from "../vendor/workerpool-10.0.2.mjs";
import { extractDataURI } from "@arbesk/asset-core/utils/uri.js";
import { fetchCIDAsBase64 as fetchCIDAsBase64Cached } from "@arbesk/asset-core/formats/gltf/cache-aware-fetch.js";
import { createConcurrencyLimiter } from "@arbesk/asset-core/utils/concurrency.js";
import { hashBytes, DEFAULT_HASH_ALGORITHM } from "@arbesk/asset-core/utils/hash.js";
import {
  uploadBatchToIPFSWithCredential,
  uploadToIPFSWithCredential,
} from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import {
  IPFS_URI_PREFIX,
  isComposite,
  ipfsUriFromCid,
  attachDedupMeta,
  composeGltfJson,
  decomposeGltfJson,
} from "@arbesk/asset-core/formats/gltf/gltf-core.js";
import { extFromMimeType } from "@arbesk/asset-core/formats/gltf/image-mime.js";
import { resolveGlbImageBytes } from "@arbesk/asset-core/formats/gltf/glb-image-resolve.js";
import { bakeSourceColorsOp } from "@arbesk/asset-core/formats/gltf/apply-node-colors.js";

const downloadLimiter = createConcurrencyLimiter(6);

const _inflightRawDownloads = new Map<string, Promise<ArrayBuffer>>();

console.log("[WORKER-INIT] gltf-worker module evaluating");

const HASH_ALGORITHM = DEFAULT_HASH_ALGORITHM;
const WORKER_BUFFER_PLACEHOLDER = (i: number): string => `__worker_buffer_${i}__`;
const WORKER_IMAGE_PLACEHOLDER = (i: number): string => `__worker_image_${i}__`;

let io: any = null;
function getIO(): any {
  if (!io) io = new WebIO();
  return io;
}

// ─── Remaining Worker Utilities ─────────────────────────────────────────

/**
 * Detects gzip content by its magic bytes (0x1f 0x8b).
 * @remarks Assets are stored gzipped on IPFS, so the worker must decompress
 *   them (undecompressed bytes make Babylon fail); it can't import fflate
 *   (no page import map) and uses the native DecompressionStream API instead.
 */
function isGzipped(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream("gzip");
  // DecompressionStream works on ReadableStream; wrap the bytes once.
  const readable = (
    new Response(bytes as BodyInit).body as ReadableStream
  ).pipeThrough(ds);
  const decompressed = await new Response(readable).arrayBuffer();
  return new Uint8Array(decompressed);
}

/**
 * Gzip-compresses bytes.
 * @remarks Can't import fflate (no page import map), so it uses the native
 *   CompressionStream. Compression keeps IPFS uploads small; reads sniff the
 *   gzip magic bytes, so the encoding is transparent.
 */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const readable = (
    new Response(bytes as BodyInit).body as ReadableStream
  ).pipeThrough(cs);
  const compressed = await new Response(readable).arrayBuffer();
  return new Uint8Array(compressed);
}

async function fetchRawBytes(
  cid: string,
  gatewayBase: string
): Promise<ArrayBuffer> {
  const existing = _inflightRawDownloads.get(cid);
  if (existing) {
    return existing;
  }

  const url = `${gatewayBase.replace(/\/$/, "")}/${cid}`;
  const downloadPromise = (async () => {
    // CIDs are content-addressed and immutable, and the gateway serves /ipfs/
    // with `Cache-Control: ... immutable`, so the shared browser HTTP cache is
    // always safe here (matches the main thread's remote-ipfs.js).
    const response = await downloadLimiter.run(() =>
      fetch(url, { cache: "default" })
    );
    if (!response.ok) {
      throw new Error(
        `Worker compose: gateway returned ${response.status} for ${cid}`
      );
    }
    return await response.arrayBuffer();
  })();

  _inflightRawDownloads.set(cid, downloadPromise);
  downloadPromise
    .catch(() => {})
    .finally(() => {
      _inflightRawDownloads.delete(cid);
    });

  return downloadPromise;
}

async function fetchDecompressedBytes(
  cid: string,
  gatewayBase: string
): Promise<ArrayBuffer> {
  let bytes = new Uint8Array(await fetchRawBytes(cid, gatewayBase));
  if (isGzipped(bytes)) {
    const before = bytes.length;
    bytes = await gunzip(bytes);
    console.log(
      `[WORKER-IPFS] gunzipped ${cid} ${before} → ${bytes.length} bytes`
    );
  }
  return bytes.buffer as ArrayBuffer;
}

async function fetchCIDAsBase64(
  cid: string,
  arbeskMeta: any,
  gatewayBase: string
): Promise<string> {
  return fetchCIDAsBase64Cached(cid, arbeskMeta, {
    fetchRaw: (c: string) => fetchRawBytes(c, gatewayBase),
    fetchDecompressed: (c: string) => fetchDecompressedBytes(c, gatewayBase),
    decompress: gunzip,
  });
}

// ─── Operations ─────────────────────────────────────────────────────────────

async function compose(payload: any) {
  const { compositeJson, gatewayBase } = payload || {};
  if (!compositeJson) throw new Error("compose: gltfJson is null");
  if (!gatewayBase) throw new Error("compose: gatewayBase is required");

  const composedJson = await composeGltfJson(compositeJson, (cid, meta) =>
    fetchCIDAsBase64(cid, meta, gatewayBase)
  );
  // Stringify + encode here so the result crosses the worker boundary as a
  // transferred ArrayBuffer (zero-copy) instead of a giant structured-cloned
  // JSON object the main thread would re-stringify.
  const composedBytes = new TextEncoder().encode(JSON.stringify(composedJson));
  return new Transfer({ composedBytes }, [composedBytes.buffer]);
}

interface ExtractedBufferEntry {
  name: string;
  bytes: Uint8Array | null;
  mime: string;
  skip?: boolean;
}

interface ExtractedImageEntry {
  name: string;
  bytes: Uint8Array | null;
  mime: string | null;
  skip?: boolean;
}

async function decomposeGltf(payload: any) {
  const { gltfJson } = payload || {};
  if (!gltfJson) throw new Error("decomposeGltf: gltf is null");
  if (isComposite(gltfJson)) {
    return { composite: gltfJson, buffers: [], images: [] };
  }

  const buffers: ExtractedBufferEntry[] = [];
  const images: ExtractedImageEntry[] = [];
  const composite = await decomposeGltfJson(gltfJson, {
    logPrefix: "[WORKER-DECOMPOSE]",
    onBuffer: (i, buf, extracted) => {
      buffers.push({
        name: `buffer_${i}.bin`,
        bytes: extracted.bytes,
        mime: extracted.mimeType,
      });
      return { ...buf, uri: WORKER_BUFFER_PLACEHOLDER(buffers.length - 1) };
    },
    onImage: (i, img, extracted) => {
      const ext = extFromMimeType(extracted.mimeType);
      images.push({
        name: `texture_${i}.${ext}`,
        bytes: extracted.bytes,
        mime: extracted.mimeType,
      });
      return { ...img, uri: WORKER_IMAGE_PLACEHOLDER(images.length - 1) };
    },
  });

  return { composite, buffers, images };
}

function resolveBufferBytes(
  buf: any,
  binaryChunk: ArrayBuffer | Uint8Array | null
): Uint8Array | null {
  if (!buf.uri) {
    if (!binaryChunk) {
      throw new Error(
        "resolveBufferBytes: GLB buffer has no uri and no binary chunk"
      );
    }
    return new Uint8Array(binaryChunk as ArrayBuffer);
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

/**
 * Resolves each embedded GLB buffer to bytes and rewrites the composite
 * entries to worker placeholders.
 * @remarks Skips ipfs:// refs and external URIs; mutates composite.buffers.
 */
function extractGlbBuffers(
  composite: any,
  binaryChunk: ArrayBuffer | Uint8Array | null
): { buffers: ExtractedBufferEntry[]; bufferBytesByIndex: Uint8Array[] } {
  const buffers: ExtractedBufferEntry[] = [];
  const bufferBytesByIndex: Uint8Array[] = [];
  const gltfBuffers = composite.buffers || [];
  for (let i = 0; i < gltfBuffers.length; i++) {
    const buf = gltfBuffers[i];

    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) {
      buffers.push({
        name: `buffer_${i}.bin`,
        bytes: null,
        mime: "application/octet-stream",
        skip: true,
      });
      continue;
    }

    if (buf.uri && !buf.uri.startsWith("data:")) {
      console.log(
        `[WORKER-DECOMPOSE] GLB buffer[${i}] external URI, keeping as-is`
      );
      continue;
    }

    const bytes = resolveBufferBytes(buf, binaryChunk);
    if (!bytes) {
      console.warn(
        `[WORKER-DECOMPOSE] GLB buffer[${i}] could not be resolved, skipping`
      );
      continue;
    }

    const name = `buffer_${i}.bin`;
    buffers.push({ name, bytes, mime: "application/octet-stream" });
    bufferBytesByIndex[i] = bytes;
    composite.buffers[i] = {
      ...buf,
      uri: WORKER_BUFFER_PLACEHOLDER(buffers.length - 1),
    };
  }
  return { buffers, bufferBytesByIndex };
}

/**
 * Extracts each embedded GLB image and rewrites the composite entries to
 * worker placeholders.
 * @remarks ipfs:// refs become skip entries; external URIs stay as-is.
 *   Mutates composite.images.
 */
function extractGlbImages(
  composite: any,
  bufferBytesByIndex: Uint8Array[]
): ExtractedImageEntry[] {
  const images: ExtractedImageEntry[] = [];
  const gltfImages = composite.images || [];
  for (let i = 0; i < gltfImages.length; i++) {
    const img = gltfImages[i];

    if (img.uri && !img.uri.startsWith("data:")) {
      if (img.uri.startsWith(IPFS_URI_PREFIX)) {
        images.push({
          name: `texture_${i}.bin`,
          bytes: null,
          mime: "image/png",
          skip: true,
        });
      } else {
        console.log(
          `[WORKER-DECOMPOSE] GLB image[${i}] external URI, keeping as-is`
        );
      }
      continue;
    }

    const resolved = resolveGlbImageBytes(
      composite, bufferBytesByIndex, img, i, "[WORKER-DECOMPOSE] GLB"
    );
    if (!resolved) continue;
    const { bytes, mimeType } = resolved;

    const ext = extFromMimeType(mimeType);
    const name = `texture_${i}.${ext}`;
    images.push({ name, bytes, mime: mimeType });
    composite.images[i] = {
      ...img,
      uri: WORKER_IMAGE_PLACEHOLDER(images.length - 1),
    };
    if (mimeType && !composite.images[i].mimeType) {
      composite.images[i].mimeType = mimeType;
    }
  }
  return images;
}

async function decomposeGlb(payload: any) {
  const { arrayBuffer } = payload || {};
  if (!arrayBuffer) throw new Error("decomposeGlb: arrayBuffer is required");

  // Note: asset-core's parseGLB is not imported here — it pulls the bare
  // `@gltf-transform/core` specifier, unresolvable in the worker (see header).
  const { json, resources } = await getIO().binaryToJSON(
    new Uint8Array(arrayBuffer)
  );
  const binBytes = resources[GLB_BUFFER];
  const binaryChunk = binBytes
    ? binBytes.buffer.slice(
        binBytes.byteOffset,
        binBytes.byteOffset + binBytes.byteLength
      )
    : null;

  const composite = JSON.parse(JSON.stringify(json));
  const { buffers, bufferBytesByIndex } = extractGlbBuffers(composite, binaryChunk);
  const images = extractGlbImages(composite, bufferBytesByIndex);

  return { composite, buffers, images };
}

const bakeSourceColors = bakeSourceColorsOp;

function sanitizeAsyncName(name: any): string {
  return (
    String(name || "asset")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .slice(0, 40) || "asset"
  );
}

function rewritePlaceholderTargets(
  targets: any,
  placeholder: string,
  cid: string,
  meta: any
): void {
  for (const t of targets || []) {
    if (t.uri === placeholder) {
      const updated = { ...t, uri: ipfsUriFromCid(cid) };
      Object.assign(t, attachDedupMeta(updated, meta));
    }
  }
}

/**
 * Uploads a list of extracted items and rewrites the matching placeholder
 * URIs in the composite target arrays.
 */
async function uploadExtractedItems(
  items: ExtractedImageEntry[],
  targets: any,
  credential: UploadCredential,
  dedupMap: Map<string, string> | null,
  makePlaceholder: (i: number) => string
): Promise<void> {
  const uploads: Array<{
    name: string;
    bytes: Uint8Array;
    placeholder: string;
    meta: object;
  }> = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.skip || !item.bytes) continue;

    // Hash over the RAW bytes so the dedup/content-cache key matches the
    // main-thread path regardless of which compressor produced the stored
    // bytes (see packages/asset-core/src/gltf/dedup.ts).
    const meta = {
      hash: hashBytes(item.bytes),
      hashAlgo: HASH_ALGORITHM,
      compressed: true,
      bytes: item.bytes.length,
    };
    const placeholder = makePlaceholder(idx);

    if (dedupMap?.has(meta.hash)) {
      const cid = dedupMap.get(meta.hash) as string;
      rewritePlaceholderTargets(targets, placeholder, cid, meta);
      continue;
    }

    uploads.push({
      name: item.name,
      bytes: item.bytes,
      placeholder,
      meta,
    });
  }

  if (uploads.length === 0) return;

  // Gzip each component before upload. Keyed by the compressed filename so the
  // batch response lines map back to the right placeholder.
  const files = await Promise.all(
    uploads.map(async (u) => ({
      name: `${u.name}.gz`,
      data: await gzip(u.bytes),
    }))
  );
  const cidMap = await uploadBatchToIPFSWithCredential(files, credential);

  for (const u of uploads) {
    const cid = cidMap.get(`${u.name}.gz`);
    if (!cid) {
      throw new Error(`Worker upload missing CID for ${u.name}`);
    }
    rewritePlaceholderTargets(targets, u.placeholder, cid, u.meta);
  }
}

/** Upload extracted buffers + images in parallel, rewriting placeholders. */
async function uploadBuffersAndImages(
  composite: any,
  buffers: any[],
  images: any[],
  credential: UploadCredential,
  dedupMap: Map<string, string> | null
): Promise<void> {
  await Promise.all([
    uploadExtractedItems(
      buffers,
      composite.buffers,
      credential,
      dedupMap,
      WORKER_BUFFER_PLACEHOLDER
    ),
    uploadExtractedItems(
      images,
      composite.images,
      credential,
      dedupMap,
      WORKER_IMAGE_PLACEHOLDER
    ),
  ]);
}

/**
 * Decomposes a glTF and uploads its buffers/images.
 * @returns the composite with ipfs:// URIs already in place.
 */
async function decomposeAndUploadGltf(payload: any) {
  const { gltfJson, credential, options = {} } = payload || {};
  if (!gltfJson) throw new Error("decomposeAndUploadGltf: gltfJson is required");
  if (!credential) {
    throw new Error("decomposeAndUploadGltf: credential is required");
  }

  const { composite, buffers, images } = await decomposeGltf({ gltfJson });
  await uploadBuffersAndImages(composite, buffers, images, credential, options.dedupMap || null);

  // No raw buffers/images are returned; they were uploaded in the worker.
  return { composite, buffers: [], images: [] };
}

/**
 * Decomposes a GLB and uploads its buffers/images.
 * @remarks When storeComposite is true, also uploads the composite JSON and
 *   returns its CID.
 */
async function decomposeAndUploadGlb(payload: any) {
  const { arrayBuffer, credential, options = {} } = payload || {};
  if (!arrayBuffer) throw new Error("decomposeAndUploadGlb: arrayBuffer is required");
  if (!credential) {
    throw new Error("decomposeAndUploadGlb: credential is required");
  }

  const storeComposite = options.storeComposite !== false;
  const { composite, buffers, images } = await decomposeGlb({ arrayBuffer });

  await uploadBuffersAndImages(composite, buffers, images, credential, options.dedupMap || null);

  let compositeCid = null;
  if (storeComposite) {
    const baseName = sanitizeAsyncName(options.assetName || options.assetId);
    const compositeName = baseName ? `${baseName}_composite.gltf` : "composite.gltf";
    // Gzip the composite JSON to match the glTF path (which compresses via
    // writeJSONToIPFS). Reads sniff the gzip magic bytes, so the `.gz` is
    // transparent to the loader.
    const compositeBytes = await gzip(
      new TextEncoder().encode(JSON.stringify(composite))
    );
    compositeCid = await uploadToIPFSWithCredential(
      compositeBytes,
      `${compositeName}.gz`,
      credential
    );
  }

  return { composite, compositeCid, buffers: [], images: [] };
}

// ─── Worker Registration ────────────────────────────────────────────────────

function collectTransferables(result: any): ArrayBuffer[] {
  const transfer: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  for (const list of [result.buffers, result.images]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const buffer = item?.bytes?.buffer;
      if (buffer && !item.skip && !seen.has(buffer)) {
        seen.add(buffer);
        transfer.push(buffer);
      }
    }
  }
  return transfer;
}

function wrapWithTransfer(handler: (payload: any) => Promise<any> | any) {
  return async (payload: any) => {
    const result = await handler(payload);
    const transfer = collectTransferables(result);
    return transfer.length > 0 ? new Transfer(result, transfer) : result;
  };
}

try {
  workerpool.worker({
    // Builds its own Transfer (transfers composedBytes.buffer directly).
    compose,
    decomposeGltf: wrapWithTransfer(decomposeGltf),
    decomposeGlb: wrapWithTransfer(decomposeGlb),
    decomposeAndUploadGltf: wrapWithTransfer(decomposeAndUploadGltf),
    decomposeAndUploadGlb: wrapWithTransfer(decomposeAndUploadGlb),
    bakeSourceColors: wrapWithTransfer(bakeSourceColors),
    ping: () => "pong",
  });
  console.log("[WORKER-INIT] methods registered");
} catch (err) {
  const initErr = err as Error;
  console.error("[WORKER-INIT] failed to register methods:", initErr);
  // Register an emergency reporter so the main thread can retrieve the
  // initialization error instead of guessing why custom methods are missing.
  try {
    workerpool.worker({
      initError: () => ({
        message: initErr?.message || String(initErr),
        stack: initErr?.stack || null,
      }),
    });
    console.log("[WORKER-INIT] initError reporter registered");
  } catch (inner) {
    console.error(
      "[WORKER-INIT] failed to register initError reporter:",
      inner
    );
  }
  throw err;
}
