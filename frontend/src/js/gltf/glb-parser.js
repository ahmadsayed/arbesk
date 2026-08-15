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
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { sanitizeFileName, extractDataURI } from "../utils/uri.js";
import {
  uploadWithDedup,
  attachDedupMeta,
  ipfsUriFromCid,
} from "./dedup.js";

// serializeGLB lives in gltf-core.js (shared with the backend, which packs
// composed composites to GLB for Tripo uploads) — re-exported here so
// existing glb-parser consumers keep working.
export { serializeGLB } from "./gltf-core.js";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const IPFS_URI_PREFIX = "ipfs://";

/** @type {WebIO|null} */
let _io = null;
function getIO() {
  if (!_io) _io = new WebIO();
  return _io;
}

/**
 * Check if an ArrayBuffer looks like a GLB v2 container.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {boolean}
 */
export function isGLB(arrayBuffer) {
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
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ json: any, binaryChunk: ArrayBuffer|null }>}
 */
export async function parseGLB(arrayBuffer) {
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
    ? /** @type {ArrayBuffer} */ (
        binBytes.buffer.slice(
          binBytes.byteOffset,
          binBytes.byteOffset + binBytes.byteLength
        )
      )
    : null;

  return { json, binaryChunk };
}

/**
 * Detect image MIME type from magic bytes.
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
function detectImageMimeType(bytes) {
  if (bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" ... "WEBP"
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
  // KTX2: magic "\xABKTX 11\xBB" plus "\r\n\x1A\n"
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
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return "image/gif";
  }
  return null;
}

/**
 * Get file extension from a MIME type.
 * @param {string|null|undefined} mimeType
 * @returns {string}
 */
function extFromMimeType(mimeType) {
  if (!mimeType) return "bin";
  /** @type {Object<string, string>} */
  const map = {
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
 * Write bytes to IPFS using the provided writer or the default project writer.
 * When no writer is supplied, the dedup-aware upload path is used so unchanged
 * components can reuse their previous CID.
 *
 * @param {((bytes: Uint8Array|string, filename: string) => Promise<string>)|null|undefined} writer
 * @param {Uint8Array|string} bytes - Raw bytes (a JSON string only when `writer` is supplied)
 * @param {string} filename
 * @param {import("../ipfs/upload-with-credential.js").UploadCredential|null} [credential=null]
 * @param {object} [options={}]
 * @param {boolean} [options.compress=false]
 * @param {Map<string, string>|null} [dedupMap=null]
 * @returns {Promise<{cid: string, meta: object|null, skipped: boolean}>}
 */
async function writeBytes(
  writer,
  bytes,
  filename,
  credential = null,
  options = {},
  dedupMap = null
) {
  if (writer) {
    const cid = await writer(bytes, filename);
    return { cid, meta: null, skipped: false };
  }
  // The string form only ever reaches the writer branch above; the default
  // path always receives Uint8Array component bytes.
  return uploadWithDedup(
    /** @type {Uint8Array} */ (bytes),
    filename,
    credential,
    options,
    dedupMap
  );
}

/**
 * Resolve a buffer URI to a Uint8Array.
 * @param {any} buf - glTF buffer entry (dynamic schema)
 * @param {ArrayBuffer|null} binaryChunk
 * @returns {Uint8Array|null}
 */
function resolveBufferBytes(buf, binaryChunk) {
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

/**
 * Decompose a GLB in-memory into a composite glTF JSON with IPFS CID references.
 *
 * @param {ArrayBuffer} arrayBuffer - Raw GLB bytes
 * @param {((bytes: Uint8Array|string, filename: string) => Promise<string>)|null} [writer] - Optional IPFS writer `(bytes, filename) => Promise<cid>`
 * @param {object} [options] - When `storeComposite` is
 *   false, buffers/images are still uploaded but the composite glTF itself is
 *   not written to IPFS (`compositeCid` is null). Use this when the caller
 *   mutates the composite and writes its own final version.
 * @param {boolean} [options.storeComposite=true]
 * @param {import("../ipfs/upload-with-credential.js").UploadCredential|null} [options.credential=null]
 * @param {boolean} [options.compress=true]
 * @param {string} [options.assetName]
 * @param {string} [options.assetId]
 * @param {Map<string, string>|null} [options.dedupMap=null]
 * @returns {Promise<{ composite: any, compositeCid: string|null }>}
 */
export async function decomposeGLB(arrayBuffer, writer, options = {}) {
  if (!arrayBuffer) throw new Error("decomposeGLB: arrayBuffer is required");
  const {
    storeComposite = true,
    credential = null,
    compress = true,
    assetName,
    assetId,
    dedupMap = null,
  } = options;

  const baseName = sanitizeFileName(/** @type {string} */ (assetName || assetId));

  const { json, binaryChunk } = await parseGLB(arrayBuffer);
  const composite = JSON.parse(JSON.stringify(json));
  const stats = { buffers: 0, images: 0, bytesTotal: 0, skipped: 0 };

  // Resolve each buffer to bytes, but don't upload yet - images may be
  // extracted from bufferViews and pruned before the final buffer CID is written.
  /** @type {Array<Uint8Array|undefined>} */
  const bufferBytesByIndex = [];
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

  // Extract images to IPFS and record buffer ranges that can be pruned.
  // Image extraction is synchronous; the actual uploads run in parallel so
  // GLBs with many textures don't pay a serial upload penalty.
  /** @type {Map<number, Array<{bufferIndex: number, oldBvIndex: number, start: number, end: number}>>} */
  const imageRemovalsByBuffer = new Map();
  const images = composite.images || [];
  /** @type {Array<{index: number, img: any, bytes: Uint8Array, mimeType: string|null, removal: {bufferIndex: number, oldBvIndex: number, start: number, end: number}|null}>} */
  const imageUploadTasks = [];

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

    let bytes = null;
    let mimeType = img.mimeType || null;

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
          `[GLB-DECOMPOSE] image[${i}] bufferView ${img.bufferView} not found`
        );
        continue;
      }
      const srcBytes = bufferBytesByIndex[bufferView.buffer];
      if (!srcBytes) {
        console.warn(
          `[GLB-DECOMPOSE] image[${i}] buffer ${bufferView.buffer} could not be resolved`
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
        `[GLB-DECOMPOSE] image[${i}] has no uri or bufferView, skipping`
      );
      continue;
    }

    if (!bytes || bytes.length === 0) {
      console.warn(`[GLB-DECOMPOSE] image[${i}] empty payload, skipping`);
      continue;
    }

    /** @type {{bufferIndex: number, oldBvIndex: number, start: number, end: number}|null} */
    let removal = null;
    if (img.bufferView !== undefined) {
      const bv = composite.bufferViews[img.bufferView];
      removal = {
        bufferIndex: bv.buffer,
        oldBvIndex: img.bufferView,
        start: bv.byteOffset || 0,
        end: (bv.byteOffset || 0) + bv.byteLength,
      };
    }

    imageUploadTasks.push({ index: i, img, bytes, mimeType, removal });
  }

  await Promise.all(
    imageUploadTasks.map(async ({ index, img, bytes, mimeType, removal }) => {
      const ext = extFromMimeType(mimeType);
      const filename = `${baseName}_texture_${index}.${ext}`;
      const { cid, meta, skipped } = await writeBytes(
        writer,
        bytes,
        filename,
        credential,
        { compress },
        dedupMap
      );
      let newImg = { ...img, uri: ipfsUriFromCid(cid) };
      if (meta) newImg = attachDedupMeta(newImg, meta);
      delete newImg.bufferView;
      if (mimeType && !newImg.mimeType) {
        newImg.mimeType = mimeType;
      }
      images[index] = newImg;
      stats.images++;
      stats.bytesTotal += bytes.length;
      if (skipped) stats.skipped++;
      console.log(
        `[GLB-DECOMPOSE] image[${index}] → ipfs://${cid} (${bytes.length} bytes)${
          skipped ? " [dedup]" : ""
        }`
      );

      if (removal) {
        const list = imageRemovalsByBuffer.get(removal.bufferIndex) || [];
        list.push(removal);
        imageRemovalsByBuffer.set(removal.bufferIndex, list);
      }
    })
  );

  // Remove extracted image bytes from the buffer(s) so we don't store them twice.
  if (imageRemovalsByBuffer.size > 0) {
    pruneBufferImageData(composite, bufferBytesByIndex, imageRemovalsByBuffer);
  }

  // Collect buffer upload tasks. Pruning must finish before these run so the
  // geometry payloads are consistent, but the uploads themselves can overlap.
  /** @type {Array<{index: number, buf: object, bytes: Uint8Array}>} */
  const bufferUploadTasks = [];

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

    bufferUploadTasks.push({ index: i, buf, bytes });
  }

  await Promise.all(
    bufferUploadTasks.map(async ({ index, buf, bytes }) => {
      const filename = `${baseName}_buffer_${index}.bin`;
      const { cid, meta, skipped } = await writeBytes(
        writer,
        bytes,
        filename,
        credential,
        { compress },
        dedupMap
      );
      let updatedBuf = { ...buf, uri: ipfsUriFromCid(cid) };
      if (meta) updatedBuf = attachDedupMeta(updatedBuf, meta);
      buffers[index] = updatedBuf;
      stats.buffers++;
      stats.bytesTotal += bytes.length;
      if (skipped) stats.skipped++;
      console.log(
        `[GLB-DECOMPOSE] buffer[${index}] → ipfs://${cid} (${bytes.length} bytes)${
          skipped ? " [dedup]" : ""
        }`
      );
    })
  );

  console.log(
    `[GLB-DECOMPOSE] done | buffers=${stats.buffers} images=${stats.images} skipped=${stats.skipped} totalBytes=${stats.bytesTotal}`
  );

  let compositeCid = null;
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
      compositeCid = await writeJSONToIPFS(composite, credential, {
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

/**
 * Remove image byte ranges from GLB buffers after the images have been extracted
 * to separate IPFS objects. Updates bufferViews, accessors, and buffer byteLength
 * so geometry data is preserved and we don't store the image bytes twice.
 *
 * @param {any} composite - Composite glTF JSON being built (mutated; dynamic schema)
 * @param {Array<Uint8Array|undefined>} bufferBytesByIndex - Resolved buffer bytes (mutated)
 * @param {Map<number, Array<{bufferIndex: number, oldBvIndex: number, start: number, end: number}>>} removalsByBuffer
 */
function pruneBufferImageData(composite, bufferBytesByIndex, removalsByBuffer) {
  const allRemovedIndices = new Set();
  for (const list of removalsByBuffer.values()) {
    for (const r of list) allRemovedIndices.add(r.oldBvIndex);
  }

  // Collect bufferViews referenced by accessors or mesh extensions so we don't
  // corrupt geometry by pruning a range that is still needed.
  const referenced = new Set();
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

  const indicesToRemove = new Set();
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

  const oldBufferViews = composite.bufferViews || [];
  const newBufferViews = [];
  const mapping = new Map();
  for (let i = 0; i < oldBufferViews.length; i++) {
    if (indicesToRemove.has(i)) continue;
    mapping.set(i, newBufferViews.length);
    newBufferViews.push(oldBufferViews[i]);
  }
  composite.bufferViews = newBufferViews;

  // Renumber all remaining bufferView references.
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

  for (const [bufferIndex, removals] of removalsByBuffer) {
    const bytes = bufferBytesByIndex[bufferIndex];
    if (!bytes) continue;

    const relevant = removals.filter((r) => indicesToRemove.has(r.oldBvIndex));
    if (relevant.length === 0) continue;

    relevant.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of relevant) {
      if (merged.length === 0 || r.start > merged[merged.length - 1].end) {
        merged.push({ start: r.start, end: r.end });
      } else {
        merged[merged.length - 1].end = Math.max(
          merged[merged.length - 1].end,
          r.end
        );
      }
    }

    // Abort if a remaining bufferView overlaps a range we want to prune.
    let abort = false;
    for (const bv of composite.bufferViews) {
      if (bv.buffer !== bufferIndex) continue;
      const start = bv.byteOffset || 0;
      const end = start + bv.byteLength;
      for (const r of merged) {
        if (end <= r.start || start >= r.end) continue;
        console.warn(
          `[GLB-DECOMPOSE] buffer ${bufferIndex}: remaining bufferView overlaps pruned image range, aborting prune`
        );
        abort = true;
        break;
      }
      if (abort) break;
    }
    if (abort) continue;

    // Build the new, smaller buffer bytes.
    const parts = [];
    let last = 0;
    for (const r of merged) {
      if (r.start > last) parts.push(bytes.subarray(last, r.start));
      last = r.end;
    }
    if (last < bytes.length) parts.push(bytes.subarray(last));

    const newLength = parts.reduce((sum, p) => sum + p.length, 0);
    const newBytes = new Uint8Array(newLength);
    let pos = 0;
    for (const p of parts) {
      newBytes.set(p, pos);
      pos += p.length;
    }

    // Adjust byteOffset for every remaining bufferView that uses this buffer.
    for (const bv of composite.bufferViews) {
      if (bv.buffer !== bufferIndex) continue;
      const oldOffset = bv.byteOffset || 0;
      let adjustment = 0;
      for (const r of merged) {
        if (r.end <= oldOffset) adjustment += r.end - r.start;
      }
      bv.byteOffset = oldOffset - adjustment;
    }

    bufferBytesByIndex[bufferIndex] = newBytes;
    composite.buffers[bufferIndex].byteLength = newBytes.length;
  }
}
