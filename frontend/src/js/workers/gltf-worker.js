// @ts-nocheck
/**
 * Arbesk glTF Web Worker
 *
 * Offloads CPU/network-heavy glTF operations from the browser main thread:
 *   - composition (ipfs:// CID → data URI)
 *   - decomposition (data URI → extracted bytes + placeholder composite)
 *   - GLB parsing/decomposition
 *   - source color baking (per-node material color mutation)
 *
 * This worker is intentionally self-contained: it does NOT import project
 * modules that rely on the DOM, session state, or import maps. Web Workers
 * don't inherit the page's import map, so @gltf-transform/core is loaded
 * from the same vendored bundle the main thread's import map points at
 * (see frontend/src/js/vendor/README.md) via a relative path instead.
 */

import { WebIO, GLB_BUFFER } from "../vendor/gltf-transform-core-4.1.2.js";
import workerpool, { Transfer } from "../vendor/workerpool-10.0.2.mjs";
import { base64ToBytes, arrayBufferToBase64 } from "../utils/encoding.js";
import { extractDataURI } from "../utils/uri.js";

console.log("[WORKER-INIT] gltf-worker module evaluating");

const IPFS_URI_PREFIX = "ipfs://";
const BASE64_BUFFER_PREFIX = "data:application/octet-stream;base64,";
const BASE64_IMAGE_PREFIX = "data:image/";
const WORKER_BUFFER_PLACEHOLDER = (i) => `__worker_buffer_${i}__`;
const WORKER_IMAGE_PLACEHOLDER = (i) => `__worker_image_${i}__`;

let io = null;
function getIO() {
  if (!io) io = new WebIO();
  return io;
}

// ─── Remaining Worker Utilities ─────────────────────────────────────────

function detectImageMimeType(bytes) {
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
 * Decompress a gzip stream (magic bytes 0x1f 0x8b) using the native
 * DecompressionStream API. Web Workers can't use the page import map, so we
 * can't import pako here - but DecompressionStream is a global in module
 * workers in all evergreen browsers (Chrome 80+, FF 113+, Safari 16.4+).
 * Assets are stored gzipped on IPFS (see commit 401da4b), so without this the
 * worker hands compressed bytes to Babylon.js, which fails with errors like
 * "Invalid typed array length".
 */
function isGzipped(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  // DecompressionStream works on ReadableStream; wrap the bytes once.
  const readable = new Response(bytes).body.pipeThrough(ds);
  const decompressed = await new Response(readable).arrayBuffer();
  return new Uint8Array(decompressed);
}

async function fetchCIDAsBase64(cid, gatewayBase) {
  const url = `${gatewayBase.replace(/\/$/, "")}/${cid}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `Worker compose: gateway returned ${response.status} for ${cid}`
    );
  }
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (isGzipped(bytes)) {
    const before = bytes.length;
    bytes = await gunzip(bytes);
    console.log(
      `[WORKER-IPFS] gunzipped ${cid} ${before} → ${bytes.length} bytes`
    );
  }
  return arrayBufferToBase64(bytes.buffer);
}

function isComposite(gltf) {
  if (!gltf) return false;
  for (const buf of gltf.buffers || []) {
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  for (const img of gltf.images || []) {
    if (img.uri && img.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  return false;
}

// ─── Operations ─────────────────────────────────────────────────────────────

async function compose(payload) {
  const { compositeJson, gatewayBase } = payload || {};
  if (!compositeJson) throw new Error("compose: gltfJson is null");
  if (!gatewayBase) throw new Error("compose: gatewayBase is required");

  const composed = JSON.parse(JSON.stringify(compositeJson));

  if (composed.buffers) {
    await Promise.all(
      composed.buffers.map(async (buf, i) => {
        const uri = buf.uri;
        if (uri && uri.startsWith(IPFS_URI_PREFIX)) {
          const cid = uri.replace(IPFS_URI_PREFIX, "");
          const base64 = await fetchCIDAsBase64(cid, gatewayBase);
          composed.buffers[i] = {
            ...buf,
            uri: `data:application/octet-stream;base64,${base64}`,
          };
        }
      })
    );
  }

  if (composed.images) {
    await Promise.all(
      composed.images.map(async (img, i) => {
        if (!img.uri) return;

        if (img.uri.startsWith(IPFS_URI_PREFIX)) {
          const cid = img.uri.replace(IPFS_URI_PREFIX, "");
          const mimeType = img.mimeType || "image/png";
          const base64 = await fetchCIDAsBase64(cid, gatewayBase);
          composed.images[i] = {
            ...img,
            uri: `data:${mimeType};base64,${base64}`,
          };
        }
      })
    );
  }

  return { composedJson: composed };
}

function decomposeGltf(payload) {
  const { gltfJson } = payload || {};
  if (!gltfJson) throw new Error("decomposeGltf: gltf is null");
  if (isComposite(gltfJson)) {
    return { composite: gltfJson, buffers: [], images: [] };
  }

  const composite = JSON.parse(JSON.stringify(gltfJson));
  const buffers = [];
  const images = [];

  if (composite.buffers) {
    for (let i = 0; i < composite.buffers.length; i++) {
      const buf = composite.buffers[i];
      if (!buf.uri) continue;
      if (buf.uri.startsWith(IPFS_URI_PREFIX)) continue;

      const extracted = extractDataURI(buf.uri);
      if (!extracted) {
        console.warn(
          `[WORKER-DECOMPOSE] buffer[${i}] unrecognized URI: ${buf.uri.substring(
            0,
            80
          )}...`
        );
        continue;
      }

      const name = `buffer_${i}.bin`;
      buffers.push({ name, bytes: extracted.bytes, mime: extracted.mimeType });
      composite.buffers[i] = {
        ...buf,
        uri: WORKER_BUFFER_PLACEHOLDER(buffers.length - 1),
      };
    }
  }

  if (composite.images) {
    for (let i = 0; i < composite.images.length; i++) {
      const img = composite.images[i];
      if (!img.uri) continue;
      if (img.uri.startsWith(IPFS_URI_PREFIX)) continue;
      if (!img.uri.startsWith("data:")) {
        console.log(
          `[WORKER-DECOMPOSE] image[${i}] external URI, keeping as-is`
        );
        continue;
      }

      const extracted = extractDataURI(img.uri);
      if (!extracted) {
        console.warn(
          `[WORKER-DECOMPOSE] image[${i}] failed to extract data URI`
        );
        continue;
      }

      const ext = extFromMimeType(extracted.mimeType);
      const name = `texture_${i}.${ext}`;
      images.push({ name, bytes: extracted.bytes, mime: extracted.mimeType });
      composite.images[i] = {
        ...img,
        uri: WORKER_IMAGE_PLACEHOLDER(images.length - 1),
      };
    }
  }

  return { composite, buffers, images };
}

function resolveBufferBytes(buf, binaryChunk) {
  if (!buf.uri) {
    if (!binaryChunk) {
      throw new Error(
        "resolveBufferBytes: GLB buffer has no uri and no binary chunk"
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

async function decomposeGlb(payload) {
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
  const buffers = [];
  const images = [];
  const bufferBytesByIndex = [];

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

function hexToBaseColorFactor(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
    1.0,
  ];
}

function findNodeMaterials(gltf, nodeName) {
  const matches = [];
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

function ensureUniqueMaterialForNodes(gltf, matches, newMaterialName) {
  if (matches.length === 0) return;

  const targetMaterialIndex = matches[0].materialIndex;
  const usedByOthers = gltf.nodes.some((node, ni) => {
    if (node.mesh === undefined || node.mesh === null) return false;
    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) return false;
    return mesh.primitives.some((prim, pi) => {
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

function bakeSourceColors(payload) {
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

    const factor = hexToBaseColorFactor(color);
    const seenMaterials = new Set();
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

// ─── Worker Registration ────────────────────────────────────────────────────

function collectTransferables(result) {
  const transfer = [];
  const seen = new Set();
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

function wrapWithTransfer(handler) {
  return async (payload) => {
    const result = await handler(payload);
    const transfer = collectTransferables(result);
    return transfer.length > 0 ? new Transfer(result, transfer) : result;
  };
}

try {
  workerpool.worker({
    compose: wrapWithTransfer(compose),
    decomposeGltf: wrapWithTransfer(decomposeGltf),
    decomposeGlb: wrapWithTransfer(decomposeGlb),
    bakeSourceColors: wrapWithTransfer(bakeSourceColors),
    ping: () => "pong",
  });
  console.log("[WORKER-INIT] methods registered");
} catch (err) {
  console.error("[WORKER-INIT] failed to register methods:", err);
  // Register an emergency reporter so the main thread can retrieve the
  // initialization error instead of guessing why custom methods are missing.
  try {
    workerpool.worker({
      initError: () => ({
        message: err?.message || String(err),
        stack: err?.stack || null,
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
