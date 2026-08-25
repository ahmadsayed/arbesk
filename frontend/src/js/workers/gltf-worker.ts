/**
 * Arbesk glTF Web Worker
 *
 * Offloads CPU/network-heavy glTF operations from the browser main thread:
 *   - composition (ipfs:// CID → data URI)
 *   - decomposition (data URI → extracted bytes + placeholder composite)
 *   - GLB parsing/decomposition
 *   - source color baking (per-node material color mutation)
 *
 * The worker runs in a separate context without the page's import map, DOM,
 * or session state, so it only imports pure project modules (gltf-core.ts,
 * utils, cache-aware-fetch). @gltf-transform/core is loaded from the same
 * vendored bundle the main thread's import map points at
 * (see frontend/src/js/vendor/README.md) via a relative path instead.
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

function detectImageMimeType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    b.length >= 12 &&
    b[0] === 0xab &&
    b[1] === 0x4b &&
    b[2] === 0x54 &&
    b[3] === 0x58 &&
    b[4] === 0x20 &&
    b[5] === 0x31 &&
    b[6] === 0x31 &&
    b[7] === 0xbb &&
    b[8] === 0x0d &&
    b[9] === 0x0a &&
    b[10] === 0x1a &&
    b[11] === 0x0a
  ) {
    return "image/ktx2";
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

function extFromMimeType(mimeType: string | null | undefined): string {
  if (!mimeType) return "bin";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/ktx2": "ktx2",
    "image/gif": "gif",
    "application/octet-stream": "bin",
  };
  return map[mimeType] || mimeType.split("/").pop() || "bin";
}

/**
 * Decompress a gzip stream (magic bytes 0x1f 0x8b) using the native
 * DecompressionStream API. Web Workers can't use the page import map, so we
 * can't import fflate here - but DecompressionStream is a global in module
 * workers in all evergreen browsers (Chrome 80+, FF 113+, Safari 16.4+).
 * Assets are stored gzipped on IPFS (see commit 401da4b), so without this the
 * worker hands compressed bytes to Babylon.js, which fails with errors like
 * "Invalid typed array length".
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
 * Gzip-compress bytes using the native CompressionStream. The worker can't
 * import fflate (no page import map), but CompressionStream is a module-worker
 * global in all evergreen browsers - the symmetric counterpart to gunzip().
 * Compressing here keeps IPFS uploads small (fewer bytes to the pinning
 * service); reads sniff the gzip magic bytes so the encoding is transparent.
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
  return { composedJson };
}

/**
 * Compose and serialize in one worker call. Stringifying + encoding the
 * composed glTF here lets the result cross the worker boundary as a
 * transferred ArrayBuffer (zero-copy) instead of a structured-cloned JSON
 * object full of giant base64 strings that the main thread would have to
 * re-stringify.
 */
async function composeToBytes(payload: any) {
  const { composedJson } = await compose(payload);
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

async function decomposeGlb(payload: any) {
  const { arrayBuffer } = payload || {};
  if (!arrayBuffer) throw new Error("decomposeGlb: arrayBuffer is required");

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
  const buffers: ExtractedBufferEntry[] = [];
  const images: ExtractedImageEntry[] = [];
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

    let bytes: Uint8Array | null = null;
    let mimeType: string | null = img.mimeType || null;

    if (img.uri && img.uri.startsWith("data:")) {
      const extracted = extractDataURI(img.uri);
      if (extracted) {
        bytes = extracted.bytes;
        mimeType = mimeType || extracted.mimeType;
      }
    } else if (img.bufferView !== undefined) {
      const bufferView = composite.bufferViews?.[img.bufferView];
      if (!bufferView) {
        console.warn(
          `[WORKER-DECOMPOSE] GLB image[${i}] bufferView ${img.bufferView} not found`
        );
        continue;
      }
      const srcBytes = bufferBytesByIndex[bufferView.buffer];
      if (!srcBytes) {
        console.warn(
          `[WORKER-DECOMPOSE] GLB image[${i}] buffer ${bufferView.buffer} could not be resolved`
        );
        continue;
      }
      const byteOffset = bufferView.byteOffset || 0;
      const byteLength = bufferView.byteLength;
      bytes = srcBytes.subarray(byteOffset, byteOffset + byteLength);
      if (!mimeType) {
        mimeType = detectImageMimeType(bytes);
      }
    } else {
      console.warn(
        `[WORKER-DECOMPOSE] GLB image[${i}] has no uri or bufferView, skipping`
      );
      continue;
    }

    if (!bytes || bytes.length === 0) {
      console.warn(
        `[WORKER-DECOMPOSE] GLB image[${i}] empty payload, skipping`
      );
      continue;
    }

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

  return { composite, buffers, images };
}

function hexToBaseColorFactor(hex: string): number[] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
    1.0,
  ];
}

interface NodeMaterialMatch {
  nodeIndex: number;
  primitiveIndex: number;
  materialIndex: number;
}

function findNodeMaterials(gltf: any, nodeName: string): NodeMaterialMatch[] {
  const matches: NodeMaterialMatch[] = [];
  if (!gltf.nodes || !gltf.meshes) return matches;

  for (let ni = 0; ni < gltf.nodes.length; ni++) {
    const node = gltf.nodes[ni];
    if (!node.name || node.name.toLowerCase() !== nodeName.toLowerCase())
      continue;
    if (node.mesh === undefined || node.mesh === null) continue;

    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) continue;

    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const prim = mesh.primitives[pi];
      if (prim.material === undefined || prim.material === null) continue;
      matches.push({
        nodeIndex: ni,
        primitiveIndex: pi,
        materialIndex: prim.material,
      });
    }
  }
  return matches;
}

function ensureUniqueMaterialForNodes(
  gltf: any,
  matches: NodeMaterialMatch[],
  newMaterialName: string
): void {
  if (matches.length === 0) return;

  const targetMaterialIndex = matches[0].materialIndex;
  const usedByOthers = gltf.nodes.some((node: any, ni: number) => {
    if (node.mesh === undefined || node.mesh === null) return false;
    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) return false;
    return mesh.primitives.some((prim: any, pi: number) => {
      const isTarget = matches.some(
        (m) => m.nodeIndex === ni && m.primitiveIndex === pi
      );
      return !isTarget && prim.material === targetMaterialIndex;
    });
  });

  if (!usedByOthers) return;

  const original = gltf.materials[targetMaterialIndex];
  if (!original) return;

  const clone = JSON.parse(JSON.stringify(original));
  clone.name = newMaterialName;
  const cloneIndex = gltf.materials.length;
  gltf.materials.push(clone);

  for (const match of matches) {
    gltf.meshes[gltf.nodes[match.nodeIndex].mesh].primitives[
      match.primitiveIndex
    ].material = cloneIndex;
    match.materialIndex = cloneIndex;
  }
}

function bakeSourceColors(payload: any) {
  const { gltfJson, nodeColors } = payload || {};
  if (!gltfJson) throw new Error("bakeSourceColors: gltfJson is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { bakedJson: gltfJson, modified: 0, skipped: 0 };
  }

  const gltf = JSON.parse(JSON.stringify(gltfJson));
  if (!gltf.materials) gltf.materials = [];

  let modified = 0;
  let skipped = 0;

  for (const [nodeName, color] of Object.entries(nodeColors)) {
    const matches = findNodeMaterials(gltf, nodeName);
    if (matches.length === 0) {
      skipped++;
      continue;
    }

    ensureUniqueMaterialForNodes(gltf, matches, `${nodeName}_color`);

    const factor = hexToBaseColorFactor(color as string);
    const seenMaterials = new Set<number>();
    for (const match of matches) {
      if (seenMaterials.has(match.materialIndex)) continue;
      seenMaterials.add(match.materialIndex);

      const mat = gltf.materials[match.materialIndex];
      if (!mat) continue;
      mat.pbrMetallicRoughness ||= {};
      mat.pbrMetallicRoughness.baseColorFactor = factor;
    }
    modified++;
  }

  return { bakedJson: gltf, modified, skipped };
}

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
 * Upload a list of extracted { name, bytes, placeholder, meta? } items using a
 * single batch call when possible, and rewrite the matching placeholder URIs
 * in the composite target arrays.
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

/**
 * Decompose a standard glTF and upload its buffers/images from the worker.
 * Returns the composite with ipfs:// URIs already in place.
 */
async function decomposeAndUploadGltf(payload: any) {
  const { gltfJson, credential, options = {} } = payload || {};
  if (!gltfJson) throw new Error("decomposeAndUploadGltf: gltfJson is required");
  if (!credential) {
    throw new Error("decomposeAndUploadGltf: credential is required");
  }

  const { composite, buffers, images } = await decomposeGltf({ gltfJson });
  await Promise.all([
    uploadExtractedItems(
      buffers,
      composite.buffers,
      credential,
      options.dedupMap || null,
      WORKER_BUFFER_PLACEHOLDER
    ),
    uploadExtractedItems(
      images,
      composite.images,
      credential,
      options.dedupMap || null,
      WORKER_IMAGE_PLACEHOLDER
    ),
  ]);

  // No raw buffers/images are returned; they were uploaded in the worker.
  return { composite, buffers: [], images: [] };
}

/**
 * Decompose a GLB and upload its buffers/images from the worker. When
 * storeComposite is true, also uploads the composite JSON and returns its CID.
 */
async function decomposeAndUploadGlb(payload: any) {
  const { arrayBuffer, credential, options = {} } = payload || {};
  if (!arrayBuffer) throw new Error("decomposeAndUploadGlb: arrayBuffer is required");
  if (!credential) {
    throw new Error("decomposeAndUploadGlb: credential is required");
  }

  const storeComposite = options.storeComposite !== false;
  const { composite, buffers, images } = await decomposeGlb({ arrayBuffer });

  await Promise.all([
    uploadExtractedItems(
      buffers,
      composite.buffers,
      credential,
      options.dedupMap || null,
      WORKER_BUFFER_PLACEHOLDER
    ),
    uploadExtractedItems(
      images,
      composite.images,
      credential,
      options.dedupMap || null,
      WORKER_IMAGE_PLACEHOLDER
    ),
  ]);

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
    compose: wrapWithTransfer(compose),
    // Builds its own Transfer (transfers composedBytes.buffer directly).
    composeToBytes,
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
