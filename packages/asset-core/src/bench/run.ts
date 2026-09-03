/**
 * asset-core benchmark harness.
 * @remarks Times the SDK's heavy operations (decompose, compose, base64
 *   encode/decode, murmur3_128) over the in-memory IPFS double on real GLB
 *   fixtures.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { createArbeskCore } from "../facade.ts";
import { createMemoryIpfs } from "../storage/memory-ipfs.ts";
import { getRuntime } from "../runtime.ts";

const benchDir = dirname(fileURLToPath(import.meta.url));
// packages/asset-core/{src,dist}/bench -> repo root
const repoRoot = join(benchDir, "..", "..", "..", "..");

export interface BenchRow {
  fixture: string;
  op: string;
  ms: number;
  bytes: number;
}

export interface RunBenchOptions {
  /** GLB fixture paths relative to the repo root. Default: every mock-gltf-assets/*.glb sorted by size. */
  fixtures?: string[];
  /** Repetitions per operation. */
  iterations?: number;
}

function readArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function nowMs(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1_000_000;
}

/**
 * Times one async operation, returning total milliseconds over `iterations`.
 * @remarks Not divided, so a single iteration is a real elapsed time.
 */
async function timeAsync(fn: () => Promise<unknown>, iterations: number): Promise<number> {
  const elapsed = nowMs();
  for (let i = 0; i < iterations; i++) await fn();
  return elapsed();
}

function timeSync(fn: () => unknown, iterations: number): number {
  const elapsed = nowMs();
  for (let i = 0; i < iterations; i++) fn();
  return elapsed();
}

function defaultFixtures(): string[] {
  const dir = join(repoRoot, "mock-gltf-assets");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".glb"))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(a).size - statSync(b).size)
    .map((abs) => `mock-gltf-assets/${abs.split("/").pop()}`);
}

export async function runBench(
  options: RunBenchOptions = {}
): Promise<BenchRow[]> {
  const iterations = options.iterations ?? 3;
  const fixtures =
    options.fixtures ?? defaultFixtures();
  const rows: BenchRow[] = [];

  // 1 MiB base64/murmur payload (allocated once).
  const kernelBytes = new Uint8Array(1024 * 1024);
  for (let i = 0; i < kernelBytes.length; i++) kernelBytes[i] = i & 0xff;

  for (const fixturePath of fixtures) {
    const absPath = join(repoRoot, fixturePath);
    const bytes = readArrayBuffer(absPath);
    const fixture = fixturePath.split("/").pop() as string;

    const { read, write } = createMemoryIpfs();
    const core = createArbeskCore({ ipfsRead: read, ipfsWrite: write });

    rows.push({
      fixture,
      op: "decompose",
      ms: await timeAsync(() => core.decompose(bytes), iterations),
      bytes: bytes.byteLength,
    });

    const { compositeCid } = await core.decompose(bytes);
    if (!compositeCid) {
      throw new Error("bench: GLB decompose stored no composite CID");
    }
    const composite = await core.getManifest(compositeCid);
    rows.push({
      fixture,
      op: "compose",
      ms: await timeAsync(() => core.compose(composite), iterations),
      bytes: bytes.byteLength,
    });

    const rt = getRuntime();
    rows.push({
      fixture,
      op: "base64",
      ms: timeSync(() => {
        const encoded = rt.kernels.base64.encode(kernelBytes);
        rt.kernels.base64.decode(encoded);
      }, iterations),
      bytes: kernelBytes.length,
    });
    rows.push({
      fixture,
      op: "hash",
      ms: timeSync(() => rt.kernels.hash.murmur3_128(kernelBytes), iterations),
      bytes: kernelBytes.length,
    });
  }

  return rows;
}

function printTable(rows: BenchRow[]): void {
  console.table(rows.map((r) => ({ ...r, ms: Number(r.ms.toFixed(3)) })));
}

function writeArtifact(rows: BenchRow[]): void {
  const outDir = join(repoRoot, "test-results");
  mkdirSync(outDir, { recursive: true });
  const artifact = {
    generatedAt: new Date().toISOString(),
    rows,
  };
  writeFileSync(
    join(outDir, "asset-core-bench.json"),
    JSON.stringify(artifact, null, 2)
  );
  console.log(`[BENCH] wrote ${join(outDir, "asset-core-bench.json")}`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rows = await runBench();
  printTable(rows);
  writeArtifact(rows);
}
