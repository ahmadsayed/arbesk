/**
 * GLB parser/serializer benchmark
 *
 * Captures performance of the @gltf-transform/core-backed parser and the
 * custom serializer on real assets.
 *
 * Run with: node test/frontend/glb-parser.bench.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  isGLB,
  parseGLB,
  serializeGLB,
  decomposeGLB,
} from "../../frontend/src/js/gltf/glb-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const resultsPath = join(__dirname, "glb-parser.bench.results.md");

const ASSETS = [
  { name: "triangle.glb", path: join(repoRoot, "mock-gltf-assets", "triangle.glb") },
  { name: "howdy.glb", path: join(repoRoot, "mock-gltf-assets", "howdy.glb") },
];

/**
 * Temporarily silence console methods so serializer fallback warnings and
 * decomposition logs don't dominate benchmark output.
 */
async function silenceConsoleDuring(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

/**
 * Time a single async operation over N iterations, returning avg/op in ms.
 */
async function benchAsync(name, fn, iterations = 50) {
  // Warmup
  for (let i = 0; i < 5; i++) await silenceConsoleDuring(fn);

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) await silenceConsoleDuring(fn);
  const end = process.hrtime.bigint();

  const totalMs = Number(end - start) / 1_000_000;
  const avgMs = totalMs / iterations;
  return { name, iterations, totalMs, avgMs };
}

/**
 * Time a single sync operation over N iterations, returning avg/op in ms.
 */
function benchSync(name, fn, iterations = 50) {
  // Warmup
  for (let i = 0; i < 5; i++) silenceConsoleDuring(fn);

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) silenceConsoleDuring(fn);
  const end = process.hrtime.bigint();

  const totalMs = Number(end - start) / 1_000_000;
  const avgMs = totalMs / iterations;
  return { name, iterations, totalMs, avgMs };
}

/**
 * Deterministic mock IPFS writer for benchmarking.
 */
function createMockWriter() {
  let counter = 0;
  return async (data, filename) => {
    counter++;
    const size =
      data instanceof ArrayBuffer
        ? data.byteLength
        : data instanceof Uint8Array
        ? data.length
        : typeof data === "string"
        ? Buffer.byteLength(data, "utf8")
        : 0;
    const hash = Buffer.from(`${filename}:${size}:${counter}`).toString("base64url");
    return `Qm${hash.slice(0, 44)}`;
  };
}

function readArrayBuffer(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function hasDraco(json) {
  const exts = [...(json.extensionsRequired || []), ...(json.extensionsUsed || [])];
  return exts.includes("KHR_draco_mesh_compression");
}

async function benchAsset(asset) {
  const buffer = readArrayBuffer(asset.path);

  if (!isGLB(buffer)) {
    throw new Error(`${asset.name} is not a valid GLB`);
  }

  console.log(`[BENCH] asset: ${asset.name} (${buffer.byteLength} bytes)`);

  const { json, binaryChunk } = await parseGLB(buffer);
  const draco = hasDraco(json);
  console.log(
    `[BENCH] nodes=${json.nodes?.length ?? 0} buffers=${json.buffers?.length ?? 0} draco=${draco}`
  );

  const results = [];

  results.push(benchSync(`${asset.name} — isGLB`, () => isGLB(buffer), 1000));
  results.push(await benchAsync(`${asset.name} — parseGLB`, () => parseGLB(buffer), 100));
  results.push(
    await benchAsync(`${asset.name} — serializeGLB (custom)`, () => serializeGLB(json, binaryChunk), 100)
  );

  results.push(
    await benchAsync(
      `${asset.name} — decomposeGLB (mock writer)`,
      () => decomposeGLB(buffer, createMockWriter()),
      20
    )
  );

  results.push(
    await benchAsync(`${asset.name} — round-trip parse/serialize`, async () => {
      const parsed = await parseGLB(buffer);
      parsed.json.asset = { ...parsed.json.asset, generator: "arbesk-bench" };
      return serializeGLB(parsed.json, parsed.binaryChunk);
    }, 100)
  );

  const serialized = await serializeGLB(json, binaryChunk);
  results.push({
    name: `${asset.name} — output byte length`,
    value: serialized.byteLength,
    unit: "bytes",
  });

  return results;
}

async function main() {
  const allResults = [];
  for (const asset of ASSETS) {
    allResults.push(...(await benchAsset(asset)));
  }

  const report = formatReport(allResults);
  console.log(report);

  const timestamp = new Date().toISOString();
  const section = `\n## Run: ${timestamp}\n\n${report}\n`;

  if (existsSync(resultsPath)) {
    writeFileSync(resultsPath, readFileSync(resultsPath, "utf8") + section);
  } else {
    writeFileSync(
      resultsPath,
      `# GLB Parser Benchmark Results\n\n` +
        `Benchmark for issue #24: replace custom GLB parser/serializer with @gltf-transform/core.\n\n` +
        section
    );
  }

  console.log(`[BENCH] results appended to ${resultsPath}`);
}

function formatReport(results) {
  return results
    .map((r) => {
      if (r.value !== undefined) {
        return `- ${r.name}: ${r.value} ${r.unit ?? ""}`;
      }
      return `- ${r.name}: ${r.avgMs.toFixed(3)} ms/op (avg over ${r.iterations} iterations, total ${r.totalMs.toFixed(1)} ms)`;
    })
    .join("\n");
}

main().catch((err) => {
  console.error("[BENCH] failed:", err);
  process.exit(1);
});
