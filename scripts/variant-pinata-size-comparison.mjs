// @ts-nocheck
/**
 * Upload all 15 variants to Pinata three ways and compare actual Pinata storage:
 *   - 15 full standalone files (no dedup)
 *   - Arbesk raw decomposition, deduplicated across variants
 *   - Arbesk gzip-compressed decomposition, deduplicated across variants
 *
 * Reads Pinata JWT/GATEWAY from .env.pinata.
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

// Load Pinata credentials from .env.pinata
const envPath = path.join(ROOT, ".env.pinata");
let PINATA_JWT = process.env.PINATA_JWT;
let PINATA_GATEWAY = process.env.PINATA_GATEWAY;
if (!PINATA_JWT || !PINATA_GATEWAY) {
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const [k, v] = line.split("=");
      if (!v) continue;
      if (k === "JWT") PINATA_JWT = v.trim();
      if (k === "GATEWAY") PINATA_GATEWAY = v.trim();
    }
  } catch {}
}
if (!PINATA_JWT) {
  console.error("FATAL: PINATA_JWT not found in .env.pinata or env");
  process.exit(1);
}

process.env.IPFS_BACKEND = "kubo";
process.env.IPFS_API_URL = "http://127.0.0.1:5001";
process.env.IPFS_GATEWAY_URL = "http://127.0.0.1:8080/ipfs/";

const { _resetStorage } = await import(
  path.join(ROOT, "src/api/storage/index.js")
);
_resetStorage();

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
const PINATA_API = "https://api.pinata.cloud/pinning";

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

async function pinataAdd(bytes, filename) {
  const blob = new Blob([bytes]);
  const form = new FormData();
  form.append("file", blob, filename);
  form.append(
    "pinataMetadata",
    JSON.stringify({ name: filename }),
  );

  const res = await fetch(`${PINATA_API}/pinFileToIPFS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed: ${res.status} - ${text}`);
  }
  const data = await res.json();
  const cid = data.IpfsHash;
  const size = data.PinSize || bytes.length;
  console.log(`[PINATA] pinned ${filename} → ${cid} (${fmt(size)})`);
  return { cid, size };
}

async function pinataUnpin(cid) {
  const res = await fetch(`${PINATA_API}/unpin/${cid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[PINATA] failed to unpin ${cid}: ${res.status} - ${text}`);
    return false;
  }
  console.log(`[PINATA] unpinned ${cid}`);
  return true;
}

async function kuboFetchBytes(cid) {
  const res = await fetch(`${KUBO_CRED.gateway}${cid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`gateway ${res.status} for ${cid}`);
  return new Uint8Array(await res.arrayBuffer());
}

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
  for (let i = 0; i < jsonPadding; i++) u8[off + 8 + jsonBytes.length + i] = 0x20;
  off += 8 + jsonBytes.length + jsonPadding;

  if (binaryChunk) {
    view.setUint32(off, binaryChunk.byteLength + binPadding, true);
    view.setUint32(off + 4, GLB_BIN_CHUNK, true);
    u8.set(new Uint8Array(binaryChunk), off + 8);
  }

  return new Uint8Array(buf);
}

function fullFileBytes(variant, type, binaryChunk) {
  if (type === "gltf") return new TextEncoder().encode(JSON.stringify(variant));
  return serializeGLB(variant, binaryChunk);
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

async function main() {
  await waitForKubo();

  const allPinataCids = [];
  const totals = { full: 0, arbeskRaw: 0, arbeskCompressed: 0 };

  console.log("| Asset | 5 full files | Arbesk raw deduped | Arbesk compressed deduped |");
  console.log("|-------|-------------:|-------------------:|--------------------------:|");

  for (const { name, type } of ASSETS) {
    const { json, binaryChunk } = await loadAsset(name, type);

    const fullPins = new Map(); // cid -> size
    const rawPins = new Map();
    const compressedPins = new Map();

    for (let v = 1; v <= VARIANT_COUNT; v++) {
      const variant = applyVariant(json, v);

      // Full file
      const fullBytes = fullFileBytes(variant, type, binaryChunk);
      const fullRes = await pinataAdd(fullBytes, `${name}-v${v}-full${type === "glb" ? ".glb" : ".gltf"}`);
      allPinataCids.push(fullRes.cid);
      fullPins.set(fullRes.cid, fullRes.size);

      // Arbesk raw
      let compositeRaw;
      if (type === "gltf") {
        compositeRaw = await decomposeGlTF(variant, KUBO_CRED, { compress: false });
      } else {
        const arrayBuffer = serializeGLB(variant, binaryChunk).buffer;
        const result = await decomposeGLB(arrayBuffer, undefined, {
          storeComposite: false,
          credential: KUBO_CRED,
          compress: false,
        });
        compositeRaw = result.composite;
      }
      const rawCompositeJson = JSON.stringify(compositeRaw);
      const rawCompositeRes = await pinataAdd(
        rawCompositeJson,
        `${name}-v${v}-raw-composite.json`,
      );
      allPinataCids.push(rawCompositeRes.cid);
      rawPins.set(rawCompositeRes.cid, rawCompositeRes.size);

      for (const cid of collectCids(compositeRaw)) {
        if (rawPins.has(cid)) continue;
        const bytes = await kuboFetchBytes(cid);
        const res = await pinataAdd(bytes, `${name}-raw-${cid.slice(-8)}.bin`);
        allPinataCids.push(res.cid);
        rawPins.set(res.cid, res.size);
      }

      // Arbesk compressed
      let compositeCompressed;
      if (type === "gltf") {
        compositeCompressed = await decomposeGlTF(variant, KUBO_CRED, { compress: true });
      } else {
        const arrayBuffer = serializeGLB(variant, binaryChunk).buffer;
        const result = await decomposeGLB(arrayBuffer, undefined, {
          storeComposite: false,
          credential: KUBO_CRED,
          compress: true,
        });
        compositeCompressed = result.composite;
      }
      const compressedCompositeBytes = compress(JSON.stringify(compositeCompressed));
      const compressedCompositeRes = await pinataAdd(
        compressedCompositeBytes,
        `${name}-v${v}-compressed-composite.json.gz`,
      );
      allPinataCids.push(compressedCompositeRes.cid);
      compressedPins.set(compressedCompositeRes.cid, compressedCompositeRes.size);

      for (const cid of collectCids(compositeCompressed)) {
        if (compressedPins.has(cid)) continue;
        const bytes = await kuboFetchBytes(cid);
        const res = await pinataAdd(bytes, `${name}-compressed-${cid.slice(-8)}.bin`);
        allPinataCids.push(res.cid);
        compressedPins.set(res.cid, res.size);
      }
    }

    const assetFull = [...fullPins.values()].reduce((a, b) => a + b, 0);
    const assetRaw = [...rawPins.values()].reduce((a, b) => a + b, 0);
    const assetCompressed = [...compressedPins.values()].reduce((a, b) => a + b, 0);

    totals.full += assetFull;
    totals.arbeskRaw += assetRaw;
    totals.arbeskCompressed += assetCompressed;

    console.log(
      `| ${name} | ${fmt(assetFull)} | ${fmt(assetRaw)} | ${fmt(assetCompressed)} |`,
    );
  }

  console.log(`\n# Grand totals on Pinata (deduplicated across all 15 variants)`);
  console.log(`15 full standalone files:        ${fmt(totals.full)}`);
  console.log(`Arbesk raw (deduped):            ${fmt(totals.arbeskRaw)}`);
  console.log(`Arbesk compressed (deduped):     ${fmt(totals.arbeskCompressed)}`);
  console.log(
    `Arbesk raw vs full:              ${((1 - totals.arbeskRaw / totals.full) * 100).toFixed(1)}%`,
  );
  console.log(
    `Arbesk compressed vs full:       ${((1 - totals.arbeskCompressed / totals.full) * 100).toFixed(1)}%`,
  );
  console.log(
    `Arbesk compressed vs Arbesk raw: ${((1 - totals.arbeskCompressed / totals.arbeskRaw) * 100).toFixed(1)}%`,
  );

  console.log("\n# Cleanup (unpinning from Pinata)");
  for (const cid of new Set(allPinataCids)) {
    try {
      await pinataUnpin(cid);
    } catch (e) {
      console.warn(`unpin error for ${cid}: ${e.message}`);
    }
  }
}

function fmt(n) {
  const mb = n / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${(n / 1024).toFixed(2)} KB`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
