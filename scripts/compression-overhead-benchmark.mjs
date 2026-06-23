/**
 * Benchmark the CPU and wall-clock overhead of gzip compression/decompression
 * in the Arbesk browser decomposition pipeline compared to a plain upload.
 *
 * Runs against the local Kubo IPFS node for:
 *   - intro.gltf
 *   - howdy.glb
 *   - suka.gltf
 *
 * Usage:
 *   NODE_NO_WARNINGS=1 node ./scripts/compression-overhead-benchmark.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

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

const { writeToIPFS, writeJSONToIPFS } = await import(
  path.join(ROOT, "frontend/src/js/ipfs/write-to-ipfs.js")
);
const { compress, decompress, isGzipped } = await import(
  path.join(ROOT, "frontend/src/js/utils/compression.js")
);
const { parseGLB } = await import(
  path.join(ROOT, "frontend/src/js/gltf/glb-parser.js")
);

const KUBO_CRED = {
  backend: "kubo",
  apiUrl: "http://127.0.0.1:5001",
  gateway: "http://127.0.0.1:8080/ipfs/",
  reusable: true,
};

const ASSET_DIR = path.join(ROOT, "mock-gltf-assets");
const ASSETS = ["intro.gltf", "howdy.glb", "suka.gltf"];

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function bench(name, fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  console.log(
    `${name}: avg=${avg(times).toFixed(2)}ms min=${Math.min(...times).toFixed(2)}ms max=${Math.max(...times).toFixed(2)}ms (n=${runs})`,
  );
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

async function loadAsset(name) {
  const filePath = path.join(ASSET_DIR, name);
  if (name.endsWith(".gltf")) {
    const gltf = JSON.parse(await fs.readFile(filePath, "utf8"));
    const uri = gltf.buffers?.[0]?.uri || "";
    let bufferBytes;
    if (uri.startsWith("data:")) {
      const b64 = uri.split(",")[1];
      bufferBytes = new Uint8Array(Buffer.from(b64, "base64"));
    } else if (uri) {
      const buf = await fs.readFile(path.join(ASSET_DIR, uri));
      bufferBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      bufferBytes = new Uint8Array(0);
    }
    return { composite: gltf, bufferBytes };
  }

  if (name.endsWith(".glb")) {
    const buf = await fs.readFile(filePath);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { json, binaryChunk } = await parseGLB(arrayBuffer);
    const bufferBytes = binaryChunk
      ? new Uint8Array(binaryChunk)
      : new Uint8Array(0);
    return { composite: json, bufferBytes };
  }

  throw new Error(`Unsupported asset: ${name}`);
}

async function kuboFetch(cid) {
  const res = await fetch(`${KUBO_CRED.gateway}${cid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kubo gateway ${res.status} for ${cid}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function benchmarkAsset(name, opts = {}) {
  const cpuRuns = opts.cpuRuns ?? 5;
  const netRuns = opts.netRuns ?? 3;

  console.log(`\n#############################################`);
  console.log(`# Asset: ${name}`);
  console.log(`#############################################`);

  const { composite, bufferBytes } = await loadAsset(name);
  const compactJson = JSON.stringify(composite);
  const jsonBytes = new TextEncoder().encode(compactJson);

  console.log(`\n--- Sizes ---`);
  console.log(`Composite JSON raw: ${jsonBytes.length.toLocaleString()} bytes`);
  console.log(`Buffer raw: ${bufferBytes.length.toLocaleString()} bytes`);

  console.log(`\n=== CPU-only benchmarks (local, no network) ===`);

  let gzJson, gzBuffer;
  await bench("gzip composite JSON", () => {
    gzJson = compress(jsonBytes);
  }, cpuRuns);
  await bench("gzip buffer", () => {
    gzBuffer = compress(bufferBytes);
  }, cpuRuns);

  console.log(`  gzipped JSON size: ${gzJson.length.toLocaleString()} bytes`);
  console.log(`  gzipped buffer size: ${gzBuffer.length.toLocaleString()} bytes`);

  await bench("gunzip composite JSON", () => {
    decompress(gzJson);
  }, cpuRuns);
  await bench("gunzip buffer", () => {
    decompress(gzBuffer);
  }, cpuRuns);

  console.log(`\n=== End-to-end upload benchmarks (local Kubo) ===`);

  const cidsToUnpin = [];

  await bench(
    "upload raw composite JSON",
    async () => {
      cidsToUnpin.push(await writeJSONToIPFS(composite, KUBO_CRED, { compress: false }));
    },
    netRuns,
  );
  await bench(
    "upload gzipped composite JSON",
    async () => {
      cidsToUnpin.push(await writeJSONToIPFS(composite, KUBO_CRED, { compress: true }));
    },
    netRuns,
  );

  await bench(
    "upload raw buffer",
    async () => {
      cidsToUnpin.push(await writeToIPFS(bufferBytes, "buffer.bin", KUBO_CRED, { compress: false }));
    },
    netRuns,
  );
  await bench(
    "upload gzipped buffer",
    async () => {
      cidsToUnpin.push(await writeToIPFS(bufferBytes, "buffer.bin", KUBO_CRED, { compress: true }));
    },
    netRuns,
  );

  console.log(`\n=== End-to-end download benchmarks (local Kubo) ===`);

  const rawJsonCid = await writeJSONToIPFS(composite, KUBO_CRED, { compress: false });
  const gzJsonCid = await writeJSONToIPFS(composite, KUBO_CRED, { compress: true });
  const rawBufCid = await writeToIPFS(bufferBytes, "buffer.bin", KUBO_CRED, { compress: false });
  const gzBufCid = await writeToIPFS(bufferBytes, "buffer.bin", KUBO_CRED, { compress: true });
  cidsToUnpin.push(rawJsonCid, gzJsonCid, rawBufCid, gzBufCid);

  await bench("fetch raw composite JSON", async () => {
    await kuboFetch(rawJsonCid);
  }, netRuns);

  await bench("fetch + gunzip composite JSON", async () => {
    const bytes = await kuboFetch(gzJsonCid);
    if (!isGzipped(bytes)) throw new Error("expected gzip");
    decompress(bytes);
  }, netRuns);

  await bench("fetch raw buffer", async () => {
    await kuboFetch(rawBufCid);
  }, netRuns);

  await bench("fetch + gunzip buffer", async () => {
    const bytes = await kuboFetch(gzBufCid);
    if (!isGzipped(bytes)) throw new Error("expected gzip");
    decompress(bytes);
  }, netRuns);

  return cidsToUnpin;
}

async function main() {
  await waitForKubo();

  const allCids = [];

  for (const asset of ASSETS) {
    const isLarge = asset === "suka.gltf";
    const cids = await benchmarkAsset(asset, {
      cpuRuns: isLarge ? 3 : 5,
      netRuns: isLarge ? 2 : 3,
    });
    allCids.push(...cids);
  }

  console.log(`\n#############################################`);
  console.log(`# Cleanup`);
  console.log(`#############################################`);
  for (const cid of new Set(allCids)) {
    try {
      await storage.unpin(cid);
      console.log(`deleted ${cid}`);
    } catch (e) {
      console.warn(`failed to delete ${cid}: ${e.message}`);
    }
  }
  await fetch("http://127.0.0.1:5001/api/v0/repo/gc", { method: "POST" });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
