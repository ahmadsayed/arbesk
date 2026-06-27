/**
 * Benchmark the overhead of gzip compression against real Pinata uploads/downloads
 * for both a glTF file (intro.gltf) and a GLB file (howdy.glb).
 *
 * Run via the env wrapper:
 *   NODE_NO_WARNINGS=1 node ./scripts/run-pinata-benchmark-from-env.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY;

if (!PINATA_JWT || !PINATA_GATEWAY) {
  console.error(
    "FATAL: set PINATA_JWT and PINATA_GATEWAY environment variables to run this benchmark.",
  );
  process.exit(1);
}

process.env.IPFS_BACKEND = "pinata";
process.env.PINATA_JWT = PINATA_JWT;
process.env.PINATA_GATEWAY = PINATA_GATEWAY;
process.env.PINATA_UPLOAD_TTL = "60";

const { getStorage, _resetStorage } = await import(
  path.join(ROOT, "src/api/storage/index.js")
);
_resetStorage();
const storage = getStorage();

const { compress, decompress, isGzipped } = await import(
  path.join(ROOT, "frontend/src/js/utils/compression.js")
);
const { parseGLB } = await import(
  path.join(ROOT, "frontend/src/js/gltf/glb-parser.js")
);

const ASSET_DIR = path.join(ROOT, "mock-gltf-assets");

/**
 * @param {number[]} arr
 * @returns {number}
 */
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @param {number} [runs]
 */
async function bench(name, fn, runs = 3) {
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

/**
 * @param {string | Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function pinataAdd(bytes) {
  return storage.add(bytes);
}

/**
 * @param {string} cid
 * @returns {Promise<Uint8Array>}
 */
async function pinataFetch(cid) {
  const url = `https://${PINATA_GATEWAY}/ipfs/${cid}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Pinata gateway ${res.status} for ${cid}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * @param {string} name
 * @returns {Promise<{composite: Record<string, any>, bufferBytes: Uint8Array}>}
 */
async function loadAsset(name) {
  const filePath = path.join(ASSET_DIR, name);
  if (name.endsWith(".gltf")) {
    const gltf = JSON.parse(await fs.readFile(filePath, "utf8"));
    const b64 = gltf.buffers[0].uri.split(",")[1];
    const bufferBytes = new Uint8Array(Buffer.from(b64, "base64"));
    return { composite: gltf, bufferBytes };
  }

  if (name.endsWith(".glb")) {
    const buf = await fs.readFile(filePath);
    const arrayBuffer = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    );
    const { json, binaryChunk } = await parseGLB(arrayBuffer);
    const bufferBytes = new Uint8Array(binaryChunk);
    return { composite: json, bufferBytes };
  }

  throw new Error(`Unsupported asset: ${name}`);
}

/**
 * @param {string} assetName
 * @returns {Promise<string[]>}
 */
async function benchmarkAsset(assetName) {
  console.log(`\n#############################################`);
  console.log(`# Asset: ${assetName}`);
  console.log(`#############################################`);

  const { composite, bufferBytes } = await loadAsset(assetName);
  const compactJson = JSON.stringify(composite);

  console.log(`\n--- Sizes ---`);
  console.log(`Composite JSON raw: ${compactJson.length.toLocaleString()} bytes`);
  console.log(`Buffer raw: ${bufferBytes.length.toLocaleString()} bytes`);

  const cids = [];

  console.log(`\n--- Pinata upload ---`);
  await bench("  Pinata upload raw composite JSON", async () => {
    cids.push(await pinataAdd(compactJson));
  });

  const gzJson = compress(compactJson);
  console.log(`  gzipped JSON size: ${gzJson.length.toLocaleString()} bytes`);
  await bench("  Pinata upload gzipped composite JSON", async () => {
    cids.push(await pinataAdd(gzJson));
  });

  await bench("  Pinata upload raw buffer", async () => {
    cids.push(await pinataAdd(bufferBytes));
  });

  const gzBuffer = compress(bufferBytes);
  console.log(`  gzipped buffer size: ${gzBuffer.length.toLocaleString()} bytes`);
  await bench("  Pinata upload gzipped buffer", async () => {
    cids.push(await pinataAdd(gzBuffer));
  });

  console.log(`\n--- Pinata download (+ decompress) ---`);

  const rawJsonCid = await pinataAdd(compactJson);
  const gzJsonCid = await pinataAdd(gzJson);
  const rawBufCid = await pinataAdd(bufferBytes);
  const gzBufCid = await pinataAdd(gzBuffer);
  cids.push(rawJsonCid, gzJsonCid, rawBufCid, gzBufCid);

  await bench("  Pinata fetch raw composite JSON", async () => {
    await pinataFetch(rawJsonCid);
  });

  await bench("  Pinata fetch + gunzip composite JSON", async () => {
    const bytes = await pinataFetch(gzJsonCid);
    if (!isGzipped(bytes)) throw new Error("expected gzip");
    decompress(bytes);
  });

  await bench("  Pinata fetch raw buffer", async () => {
    await pinataFetch(rawBufCid);
  });

  await bench("  Pinata fetch + gunzip buffer", async () => {
    const bytes = await pinataFetch(gzBufCid);
    if (!isGzipped(bytes)) throw new Error("expected gzip");
    decompress(bytes);
  });

  return cids;
}

async function main() {
  const assets = ["intro.gltf", "howdy.glb"];
  const allCids = [];

  for (const asset of assets) {
    allCids.push(...(await benchmarkAsset(asset)));
  }

  console.log(`\n#############################################`);
  console.log(`# Cleanup`);
  console.log(`#############################################`);
  for (const cid of new Set(allCids)) {
    try {
      await storage.unpin(cid);
      console.log(`deleted ${cid}`);
    } catch (e) {
      const err = /** @type {Error} */ (e);
      console.warn(`failed to delete ${cid}: ${err.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
