/**
 * Compare aggregated storage sizes for the three mock assets:
 *   1. Original files (no Arbesk)
 *   2. Arbesk decomposition without compression
 *   3. Arbesk decomposition with gzip compression
 *
 * Uses the local Kubo IPFS backend for real decompose writes.
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
const { decomposeGLB } = await import(
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

async function fetchBytes(cid) {
  const res = await fetch(`${KUBO_CRED.gateway}${cid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`gateway ${res.status} for ${cid}`);
  return new Uint8Array(await res.arrayBuffer());
}

const ASSET_DIR = path.join(ROOT, "mock-gltf-assets");
const ASSETS = [
  { name: "intro.gltf", type: "gltf" },
  { name: "howdy.glb", type: "glb" },
  { name: "suka.gltf", type: "gltf" },
];

const IPFS_PREFIX = "ipfs://";

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

async function loadAsset(name, type) {
  const filePath = path.join(ASSET_DIR, name);
  if (type === "gltf") {
    const gltf = JSON.parse(await fs.readFile(filePath, "utf8"));
    return { gltf };
  }
  // GLB
  const buf = await fs.readFile(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { arrayBuffer };
}

async function main() {
  // Wait for Kubo
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch("http://127.0.0.1:5001/api/v0/id", { method: "POST" });
      if (r.ok) break;
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }

  const rows = [];
  let totalOriginal = 0;
  let totalArbeskRaw = 0;
  let totalArbeskCompressed = 0;
  const allCids = [];

  for (const { name, type } of ASSETS) {
    const filePath = path.join(ASSET_DIR, name);
    const { size: originalSize } = await fs.stat(filePath);

    let compositeRaw;
    if (type === "gltf") {
      const { gltf } = await loadAsset(name, type);
      compositeRaw = await decomposeGlTF(gltf, KUBO_CRED, { compress: false });
    } else {
      const { arrayBuffer } = await loadAsset(name, type);
      const result = await decomposeGLB(arrayBuffer, undefined, {
        storeComposite: false,
        credential: KUBO_CRED,
        compress: false,
      });
      compositeRaw = result.composite;
    }

    allCids.push(...collectCids(compositeRaw));

    const compositeJson = JSON.stringify(compositeRaw);
    const compositeRawSize = new TextEncoder().encode(compositeJson).length;

    // Extract raw buffer/image bytes from the decomposed composite references
    let bufferRawSize = 0;
    for (const cid of collectCids(compositeRaw)) {
      const bytes = await fetchBytes(cid);
      bufferRawSize += bytes.length;
    }

    const arbeskRawSize = compositeRawSize + bufferRawSize;

    // Compressed sizes
    const compositeGzSize = compress(compositeJson).length;
    let bufferGzSize = 0;
    for (const cid of collectCids(compositeRaw)) {
      const bytes = await fetchBytes(cid);
      bufferGzSize += compress(bytes).length;
    }
    const arbeskCompressedSize = compositeGzSize + bufferGzSize;

    rows.push({
      name,
      originalSize,
      arbeskRawSize,
      arbeskCompressedSize,
      compositeRawSize,
      compositeGzSize,
      bufferRawSize,
      bufferGzSize,
    });

    totalOriginal += originalSize;
    totalArbeskRaw += arbeskRawSize;
    totalArbeskCompressed += arbeskCompressedSize;
  }

  console.log("\n# Per-asset size comparison\n");
  console.log(
    "| Asset | Original | Arbesk raw | Arbesk gz | Raw vs orig | Gz vs raw |",
  );
  console.log("|-------|----------|------------|-----------|-------------|----------|");
  for (const r of rows) {
    const rawVsOrig = ((1 - r.arbeskRawSize / r.originalSize) * 100).toFixed(1);
    const gzVsRaw = ((1 - r.arbeskCompressedSize / r.arbeskRawSize) * 100).toFixed(1);
    console.log(
      `| ${r.name} | ${fmt(r.originalSize)} | ${fmt(r.arbeskRawSize)} | ${fmt(r.arbeskCompressedSize)} | ${rawVsOrig}% | ${gzVsRaw}% |`,
    );
  }

  console.log("\n# Aggregate size comparison\n");
  console.log(`Original files total:           ${fmt(totalOriginal)}`);
  console.log(`Arbesk (no compression) total:  ${fmt(totalArbeskRaw)}`);
  console.log(`Arbesk (with compression) total: ${fmt(totalArbeskCompressed)}`);
  console.log(
    `Arbesk raw vs original:         ${((1 - totalArbeskRaw / totalOriginal) * 100).toFixed(1)}%`,
  );
  console.log(
    `Arbesk gz vs Arbesk raw:        ${((1 - totalArbeskCompressed / totalArbeskRaw) * 100).toFixed(1)}%`,
  );
  console.log(
    `Arbesk gz vs original:          ${((1 - totalArbeskCompressed / totalOriginal) * 100).toFixed(1)}%`,
  );

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
