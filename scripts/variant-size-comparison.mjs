/**
 * Generate 5 color variants of each mock asset and compare per-variant sizes:
 *   - Full file size (as a standalone copy)
 *   - Arbesk decomposition without compression
 *   - Arbesk decomposition with gzip compression
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Browser globals the frontend modules expect at import time
globalThis.window = globalThis;
globalThis.localStorage = {
  _map: new Map(),
  getItem(k) { return this._map.get(k) ?? null; },
  setItem(k, v) { this._map.set(k, String(v)); },
  removeItem(k) { this._map.delete(k); },
  clear() { this._map.clear(); },
};
globalThis.document = {};
globalThis.location = { origin: "http://127.0.0.1:9090" };

const { getStorage, _resetStorage } = await import(
  path.join(ROOT, "src/api/storage/index.js")
);
process.env.IPFS_BACKEND = "kubo";
process.env.IPFS_API_URL = "http://127.0.0.1:5001";
process.env.IPFS_GATEWAY_URL = "http://127.0.0.1:8080/ipfs/";
_resetStorage();
const storage = getStorage();

const { decomposeGlTF } = await import(
  path.join(ROOT, "frontend/src/js/gltf/decomposer.js")
);
const { decomposeGLB, parseGLB } = await import(
  path.join(ROOT, "frontend/src/js/gltf/glb-parser.js")
);
const { compress } = await import(
  path.join(ROOT, "frontend/src/js/utils/compression.js")
);

const KUBO_CRED = {
  backend: "kubo",
  apiUrl: "http://127.0.0.1:5001",
  gateway: "http://127.0.0.1:8080/ipfs/",
  reusable: true,
};

const ASSET_DIR = path.join(ROOT, "mock-gltf-assets");
const ASSETS = [
  { name: "intro.gltf", type: "gltf" },
  { name: "howdy.glb", type: "glb" },
  { name: "suka.gltf", type: "gltf" },
];
const VARIANT_COUNT = 5;

const IPFS_PREFIX = "ipfs://";
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function collectCids(composite) {
  const cids = [];
  for (const buf of composite.buffers || []) {
    if (buf.uri && buf.uri.startsWith(IPFS_PREFIX)) {
      cids.push(buf.uri.slice(IPFS_PREFIX.length));
    }
  }
  for (const img of composite.images || []) {
    if (img.uri && img.uri.startsWith(IPFS_PREFIX)) {
      cids.push(img.uri.slice(IPFS_PREFIX.length));
    }
  }
  return cids;
}

async function waitForKubo() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("http://127.0.0.1:5001/api/v0/id", { method: "POST" });
      if (r.ok) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error("Kubo did not become ready in time");
}

async function fetchBytes(cid) {
  const res = await fetch(`${KUBO_CRED.gateway}${cid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`gateway ${res.status} for ${cid}`);
  return new Uint8Array(await res.arrayBuffer());
}

function serializeGLB(json, binaryChunk) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = binaryChunk ? (4 - (binaryChunk.byteLength % 4)) % 4 : 0;
  const total =
    12 +
    8 +
    jsonBytes.length +
    jsonPadding +
    (binaryChunk ? 8 + binaryChunk.byteLength + binPadding : 0);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total - 12, true);

  let off = 12;
  view.setUint32(off, jsonBytes.length + jsonPadding, true);
  view.setUint32(off + 4, GLB_JSON_CHUNK, true);
  u8.set(jsonBytes, off + 8);
  // JSON chunk must be padded with ASCII space characters.
  for (let i = 0; i < jsonPadding; i++) u8[off + 8 + jsonBytes.length + i] = 0x20;
  off += 8 + jsonBytes.length + jsonPadding;

  if (binaryChunk) {
    view.setUint32(off, binaryChunk.byteLength + binPadding, true);
    view.setUint32(off + 4, GLB_BIN_CHUNK, true);
    u8.set(new Uint8Array(binaryChunk), off + 8);
    // BIN chunk is padded with zero bytes (ArrayBuffer default).
  }

  return buf;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function applyVariant(json, variantIndex) {
  const clone = JSON.parse(JSON.stringify(json));
  const materials = clone.materials || [];
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    if (!mat.pbrMetallicRoughness) mat.pbrMetallicRoughness = {};
    const hue = ((variantIndex * 67 + i * 41) % 360);
    const [r, g, b] = hslToRgb(hue, 0.75, 0.5);
    mat.pbrMetallicRoughness.baseColorFactor = [r, g, b, 1];
  }
  return clone;
}

async function loadAsset(name, type) {
  const filePath = path.join(ASSET_DIR, name);
  if (type === "gltf") {
    const json = JSON.parse(await fs.readFile(filePath, "utf8"));
    return { json };
  }
  const buf = await fs.readFile(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { json, binaryChunk } = await parseGLB(arrayBuffer);
  return { json, binaryChunk };
}

function fullFileSize(variant, type, binaryChunk) {
  if (type === "gltf") {
    return new TextEncoder().encode(JSON.stringify(variant)).length;
  }
  return serializeGLB(variant, binaryChunk).byteLength;
}

async function main() {
  await waitForKubo();

  console.log("| Asset | Variant | Full file | Arbesk raw | Arbesk compressed |");
  console.log("|-------|---------|----------:|-----------:|------------------:|");

  const allCids = [];

  for (const { name, type } of ASSETS) {
    const { json, binaryChunk } = await loadAsset(name, type);
    const cidCache = new Map(); // cid -> { raw, compressed }

    for (let v = 1; v <= VARIANT_COUNT; v++) {
      const variant = applyVariant(json, v);
      const fullSize = fullFileSize(variant, type, binaryChunk);

      let composite;
      if (type === "gltf") {
        composite = await decomposeGlTF(variant, KUBO_CRED, { compress: false });
      } else {
        const arrayBuffer = serializeGLB(variant, binaryChunk);
        const result = await decomposeGLB(arrayBuffer, undefined, {
          storeComposite: false,
          credential: KUBO_CRED,
          compress: false,
        });
        composite = result.composite;
      }

      const cids = collectCids(composite);
      allCids.push(...cids);

      let payloadRaw = 0;
      let payloadCompressed = 0;
      for (const cid of cids) {
        let entry = cidCache.get(cid);
        if (!entry) {
          const raw = await fetchBytes(cid);
          entry = { raw: raw.length, compressed: compress(raw).length };
          cidCache.set(cid, entry);
        }
        payloadRaw += entry.raw;
        payloadCompressed += entry.compressed;
      }

      const compositeJson = JSON.stringify(composite);
      const compositeRawSize = new TextEncoder().encode(compositeJson).length;
      const compositeGzSize = compress(compositeJson).length;

      const arbeskRaw = compositeRawSize + payloadRaw;
      const arbeskCompressed = compositeGzSize + payloadCompressed;

      console.log(
        `| ${name} | #${v} | ${fmt(fullSize)} | ${fmt(arbeskRaw)} | ${fmt(arbeskCompressed)} |`,
      );
    }
  }

  console.log("\n# Cleanup");
  for (const cid of new Set(allCids)) {
    try {
      await storage.unpin(cid);
      console.log(`unpinned ${cid}`);
    } catch (e) {
      console.warn(`failed to unpin ${cid}: ${e.message}`);
    }
  }
  await fetch("http://127.0.0.1:5001/api/v0/repo/gc", { method: "POST" });
}

function fmt(n) {
  const mb = n / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = n / 1024;
  return `${kb.toFixed(2)} KB`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
