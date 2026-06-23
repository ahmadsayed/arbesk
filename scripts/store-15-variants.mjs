/**
 * Generate 5 color variants of each of the 3 mock assets, write them to disk,
 * add all 15 files to local Kubo IPFS, and confirm the counts.
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

const { parseGLB } = await import(
  path.join(ROOT, "frontend/src/js/gltf/glb-parser.js")
);

const ASSET_DIR = path.join(ROOT, "mock-gltf-assets");
const VARIANTS_DIR = path.join(ASSET_DIR, "variants");
const ASSETS = [
  { name: "intro.gltf", type: "gltf" },
  { name: "howdy.glb", type: "glb" },
  { name: "suka.gltf", type: "gltf" },
];
const VARIANT_COUNT = 5;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

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
  await fs.mkdir(VARIANTS_DIR, { recursive: true });

  const cids = [];
  const files = [];

  for (const { name, type } of ASSETS) {
    const { json, binaryChunk } = await loadAsset(name, type);
    const ext = path.extname(name);
    const base = path.basename(name, ext);

    for (let v = 1; v <= VARIANT_COUNT; v++) {
      const variant = applyVariant(json, v);
      const variantName = `${base}-v${v}${ext}`;
      const variantPath = path.join(VARIANTS_DIR, variantName);

      let bytes;
      if (type === "gltf") {
        bytes = new TextEncoder().encode(JSON.stringify(variant));
      } else {
        bytes = serializeGLB(variant, binaryChunk);
      }

      await fs.writeFile(variantPath, bytes);
      files.push(variantName);

      const cid = await storage.add(bytes);
      cids.push(cid);
      console.log(`[STORE] ${variantName} → ipfs://${cid} (${fmt(bytes.length)})`);
    }
  }

  // Disk confirmation
  const diskFiles = (await fs.readdir(VARIANTS_DIR)).filter(
    (f) => f !== ".gitkeep" && f !== ".DS_Store"
  );
  console.log(`\nDisk files in ${path.relative(ROOT, VARIANTS_DIR)}: ${diskFiles.length}`);
  diskFiles.forEach((f) => console.log(`  ${f}`));

  // IPFS pin confirmation
  const pinned = new Set();
  const res = await fetch("http://127.0.0.1:5001/api/v0/pin/ls?type=recursive", {
    method: "POST",
  });
  const pinData = await res.json();
  // Kubo pin/ls returns { Keys: { <cid>: { Type: "recursive" }, ... } }
  for (const cid of Object.keys(pinData.Keys || {})) pinned.add(cid);

  let matched = 0;
  for (const cid of cids) {
    if (pinned.has(cid)) matched++;
    else console.warn(`  MISSING PIN: ${cid}`);
  }
  console.log(`\nIPFS recursive pins matching the 15 variants: ${matched}/${cids.length}`);
  console.log(`Total recursive pins in Kubo: ${pinned.size}`);

  if (matched !== 15 || diskFiles.length !== 15) {
    console.error("\nCONFIRMATION FAILED");
    process.exit(1);
  }
  console.log("\n✅ Confirmed: 15 files on disk and 15 matching IPFS recursive pins.");
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
