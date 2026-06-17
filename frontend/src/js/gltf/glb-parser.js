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
import { writeToIPFS, writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const IPFS_URI_PREFIX = "ipfs://";
const CID_BUFFER_PREFIX = "data:application/cid;base64,";

const _io = new WebIO();

/**
 * Check if an ArrayBuffer looks like a GLB v2 container.
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
 * @returns {Promise<{ json: object, binaryChunk: ArrayBuffer }>}
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

  const { json, resources } = await _io.binaryToJSON(new Uint8Array(arrayBuffer));
  const binBytes = resources[GLB_BUFFER];
  const binaryChunk = binBytes
    ? binBytes.buffer.slice(binBytes.byteOffset, binBytes.byteOffset + binBytes.byteLength)
    : null;

  return { json, binaryChunk };
}

/**
 * Convert a base64 string to a Uint8Array.
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract bytes and mime type from a data URI.
 */
function extractDataURI(uri) {
  if (!uri || !uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.substring(0, commaIdx);
  const payload = uri.substring(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const isBase64 = header.includes(";base64");
  const bytes = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(payload);
  return { bytes, mimeType };
}

/**
 * Detect image MIME type from magic bytes.
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
 */
function extFromMimeType(mimeType) {
  if (!mimeType) return "bin";
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
 */
async function writeBytes(writer, bytes, filename) {
  const fn = writer || writeToIPFS;
  return fn(bytes, filename);
}

/**
 * Resolve a buffer URI to a Uint8Array.
 */
function resolveBufferBytes(buf, binaryChunk) {
  if (!buf.uri) {
    if (!binaryChunk) {
      throw new Error("resolveBufferBytes: GLB buffer has no uri and no binary chunk");
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
 * Fast custom GLB serializer.
 *
 * Packs glTF JSON + optional BIN chunk into a GLB v2 container without
 * decoding/re-encoding mesh data, so content-addressed CIDs remain stable.
 */
function serializeGLBCustom(json, binaryChunk = null) {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  // GLB requires each chunk's data (including padding) to be a multiple of 4 bytes.
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = binaryChunk ? (4 - (binaryChunk.byteLength % 4)) % 4 : 0;

  const headerLength = 12;
  const jsonChunkHeaderLength = 8;
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const binChunkHeaderLength = binaryChunk ? 8 : 0;
  const binChunkLength = binaryChunk ? binaryChunk.byteLength + binPadding : 0;
  const totalLength =
    headerLength + jsonChunkHeaderLength + jsonChunkLength + binChunkHeaderLength + binChunkLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, GLB_MAGIC, true);
  offset += 4;
  view.setUint32(offset, GLB_VERSION, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;

  // JSON chunk — chunkLength includes padding to match @gltf-transform/core.
  view.setUint32(offset, jsonChunkLength, true);
  offset += 4;
  view.setUint32(offset, CHUNK_TYPE_JSON, true);
  offset += 4;
  const jsonArray = new Uint8Array(buffer, offset, jsonBytes.length);
  jsonArray.set(jsonBytes);
  offset += jsonBytes.length;
  for (let i = 0; i < jsonPadding; i++) {
    view.setUint8(offset++, 0x20);
  }

  // BIN chunk — chunkLength includes padding to match @gltf-transform/core.
  if (binaryChunk) {
    view.setUint32(offset, binChunkLength, true);
    offset += 4;
    view.setUint32(offset, CHUNK_TYPE_BIN, true);
    offset += 4;
    const binArray = new Uint8Array(buffer, offset, binaryChunk.byteLength);
    binArray.set(new Uint8Array(binaryChunk));
    offset += binaryChunk.byteLength;
    for (let i = 0; i < binPadding; i++) {
      view.setUint8(offset++, 0);
    }
  }

  return buffer;
}

/**
 * Serialize a glTF JSON + optional binary chunk back into a GLB v2 container.
 *
 * Uses the fast custom serializer. It does not decode/re-encode mesh data, so
 * the binary payload (and therefore its content-addressed CID) stays identical.
 * This is kept as a utility for GLB export/download; the storage/edit path does
 * not re-serialize to GLB.
 *
 * @param {object} json — glTF JSON object
 * @param {ArrayBuffer|null} binaryChunk — Optional BIN chunk
 * @returns {ArrayBuffer} GLB bytes
 */
export function serializeGLB(json, binaryChunk = null) {
  return serializeGLBCustom(json, binaryChunk);
}

/**
 * Decompose a GLB in-memory into a composite glTF JSON with IPFS CID references.
 *
 * @param {ArrayBuffer} arrayBuffer — Raw GLB bytes
 * @param {Function} [writer] — Optional IPFS writer `(bytes, filename) => Promise<cid>`
 * @param {{ storeComposite?: boolean }} [options] — When `storeComposite` is
 *   false, buffers/images are still uploaded but the composite glTF itself is
 *   not written to IPFS (`compositeCid` is null). Use this when the caller
 *   mutates the composite and writes its own final version.
 * @returns {Promise<{ composite: object, compositeCid: string|null }>}
 */
export async function decomposeGLB(arrayBuffer, writer, options = {}) {
  if (!arrayBuffer) throw new Error("decomposeGLB: arrayBuffer is required");
  const { storeComposite = true } = options;

  const { json, binaryChunk } = await parseGLB(arrayBuffer);
  const composite = JSON.parse(JSON.stringify(json));
  const stats = { buffers: 0, images: 0, bytesTotal: 0 };

  // Resolve each buffer to bytes and upload to IPFS.
  const bufferBytesByIndex = [];
  const buffers = composite.buffers || [];

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];

    // Already a CID reference (legacy)
    if (buf.uri && buf.uri.startsWith(CID_BUFFER_PREFIX)) {
      const cid = buf.uri.replace(CID_BUFFER_PREFIX, "");
      buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
      stats.buffers++;
      console.log(`[GLB-DECOMPOSE] buffer[${i}] legacy CID → ipfs://${cid}`);
      continue;
    }

    // Already composite
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) {
      stats.buffers++;
      continue;
    }

    // External URI — keep as-is
    if (buf.uri && !buf.uri.startsWith("data:")) {
      console.log(`[GLB-DECOMPOSE] buffer[${i}] external URI, keeping as-is`);
      continue;
    }

    const bytes = resolveBufferBytes(buf, binaryChunk);
    if (!bytes) {
      console.warn(`[GLB-DECOMPOSE] buffer[${i}] could not be resolved, skipping`);
      continue;
    }

    const filename = `buffer_${i}.bin`;
    const cid = await writeBytes(writer, bytes, filename);
    buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
    bufferBytesByIndex[i] = bytes;
    stats.buffers++;
    stats.bytesTotal += bytes.length;
    console.log(`[GLB-DECOMPOSE] buffer[${i}] → ipfs://${cid} (${bytes.length} bytes)`);
  }

  // Extract images to IPFS.
  const images = composite.images || [];
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
        console.warn(`[GLB-DECOMPOSE] image[${i}] bufferView ${img.bufferView} not found`);
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
      console.warn(`[GLB-DECOMPOSE] image[${i}] has no uri or bufferView, skipping`);
      continue;
    }

    if (!bytes || bytes.length === 0) {
      console.warn(`[GLB-DECOMPOSE] image[${i}] empty payload, skipping`);
      continue;
    }

    const ext = extFromMimeType(mimeType);
    const filename = `texture_${i}.${ext}`;
    const cid = await writeBytes(writer, bytes, filename);
    images[i] = { ...img, uri: IPFS_URI_PREFIX + cid };
    if (mimeType && !images[i].mimeType) {
      images[i].mimeType = mimeType;
    }
    stats.images++;
    stats.bytesTotal += bytes.length;
    console.log(`[GLB-DECOMPOSE] image[${i}] → ipfs://${cid} (${bytes.length} bytes)`);
  }

  console.log(
    `[GLB-DECOMPOSE] done | buffers=${stats.buffers} images=${stats.images} totalBytes=${stats.bytesTotal}`
  );

  let compositeCid = null;
  if (storeComposite) {
    compositeCid = await (writer
      ? writeBytes(writer, JSON.stringify(composite, null, 2), "composite.gltf")
      : writeJSONToIPFS(composite));
    console.log(`[GLB-DECOMPOSE] composite stored → ${compositeCid}`);
  } else {
    console.log(`[GLB-DECOMPOSE] composite not stored (caller writes its own)`);
  }

  return { composite, compositeCid };
}
