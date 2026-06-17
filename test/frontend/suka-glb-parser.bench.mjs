import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const SUKA_PATH = join(ROOT, "mock-gltf-assets/suka.glb");
const BEFORE_PATH = join(ROOT, "frontend/src/js/gltf/glb-parser.before.js");

const originalWarn = console.warn;
console.warn = () => {};

function readArrayBuffer(p) {
  const buf = readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function bench(name, fn, iterations) {
  const buffer = readArrayBuffer(SUKA_PATH);
  let lastResult;
  for (let i = 0; i < 3; i++) lastResult = fn(buffer);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) lastResult = fn(buffer);
  const elapsed = performance.now() - start;
  return {
    name,
    iterations,
    totalMs: elapsed,
    msPerOp: elapsed / iterations,
    lastResult,
  };
}

async function benchAsync(name, fn, iterations) {
  const buffer = readArrayBuffer(SUKA_PATH);
  let lastResult;
  for (let i = 0; i < 3; i++) lastResult = await fn(buffer);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) lastResult = await fn(buffer);
  const elapsed = performance.now() - start;
  return {
    name,
    iterations,
    totalMs: elapsed,
    msPerOp: elapsed / iterations,
    lastResult,
  };
}

// Extract old parser from main branch into a temp module so imports resolve.
const beforeSource = execSync("git show main:frontend/src/js/gltf/glb-parser.js", {
  cwd: ROOT,
  encoding: "utf8",
});
writeFileSync(BEFORE_PATH, beforeSource);

const { isGLB: isGLBBefore, parseGLB: parseGLBBefore, serializeGLB: serializeGLBBefore } =
  await import("../../frontend/src/js/gltf/glb-parser.before.js");
const { isGLB: isGLBAfter, parseGLB: parseGLBAfter, serializeGLB: serializeGLBAfter } =
  await import("../../frontend/src/js/gltf/glb-parser.js");

const buffer = readArrayBuffer(SUKA_PATH);
console.log(`Asset: ${SUKA_PATH}`);
console.log(`Size: ${buffer.byteLength.toLocaleString()} bytes`);
console.log(`isGLB before: ${isGLBBefore(buffer)}`);
console.log(`isGLB after: ${isGLBAfter(buffer)}`);

const ITER = 5;

const beforeParse = bench("before parseGLB", (b) => parseGLBBefore(b), ITER);
const afterParse = await benchAsync("after parseGLB", (b) => parseGLBAfter(b), ITER);

const { json: jsonBefore, binaryChunk: binBefore } = parseGLBBefore(buffer);
const { json: jsonAfter, binaryChunk: binAfter } = await parseGLBAfter(buffer);

const beforeSerialize = bench("before serializeGLB", () => serializeGLBBefore(jsonBefore, binBefore), ITER);
const afterSerialize = await benchAsync("after serializeGLB", () => serializeGLBAfter(jsonAfter, binAfter), ITER);

const beforeRoundTrip = bench(
  "before round-trip",
  (b) => {
    const { json, binaryChunk } = parseGLBBefore(b);
    return serializeGLBBefore(json, binaryChunk);
  },
  ITER,
);
const afterRoundTrip = await benchAsync(
  "after round-trip",
  async (b) => {
    const { json, binaryChunk } = await parseGLBAfter(b);
    return serializeGLBAfter(json, binaryChunk);
  },
  ITER,
);

const results = [
  beforeParse,
  afterParse,
  beforeSerialize,
  afterSerialize,
  beforeRoundTrip,
  afterRoundTrip,
];

console.table(results.map((r) => ({
  name: r.name,
  iterations: r.iterations,
  totalMs: r.totalMs.toFixed(2),
  msPerOp: r.msPerOp.toFixed(2),
})));

console.log(`Output byte length before: ${beforeSerialize.lastResult?.byteLength ?? "N/A"}`);
const afterBytes = (await serializeGLBAfter(jsonAfter, binAfter)).byteLength;
console.log(`Output byte length after: ${afterBytes}`);

console.warn = originalWarn;
unlinkSync(BEFORE_PATH);
