#!/usr/bin/env bun
/**
 * Test runner: one `bun test` process per test file, run in parallel.
 *
 * @remarks Bun's mock.module() is process-global and has no resetModules(), so
 *   a mock set in one file stays active for every file after it in the same
 *   process. One process per file restores the isolation the suites were
 *   written against (a file's mocks, module cache and DOM globals die with it).
 *
 * Usage: bun scripts/run-tests.mjs [path-or-substring ...] [--jobs N] [--bail] [--coverage]
 *   No filters runs every suite under test/ and packages/*\/test/.
 *   --coverage writes an Istanbul report (coverage-final.json + html) to
 *   coverage/js, merged from one Bun lcov fragment per test file.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOTS = ["test", ...readdirSync(path.join(ROOT, "packages")).map((p) => `packages/${p}/test`)];
const SKIP_DIRS = new Set(["node_modules", "helpers", "fixtures"]);

/**
 * Every *.test.{js,ts} under a directory, relative to the repo root.
 * @param {string} dir Directory relative to the repo root.
 * @returns {string[]}
 */
function findTests(dir) {
  const abs = path.join(ROOT, dir);
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const rel = path.join(dir, name);
    if (SKIP_DIRS.has(name)) return [];
    if (statSync(path.join(ROOT, rel)).isDirectory()) return findTests(rel);
    return /\.test\.[jt]s$/.test(name) ? [rel] : [];
  });
}

const args = process.argv.slice(2);
const jobsAt = args.indexOf("--jobs");
const jobs = jobsAt >= 0 ? Number(args.splice(jobsAt, 2)[1]) : Math.max(1, os.availableParallelism());
const bailAt = args.indexOf("--bail");
const bail = bailAt >= 0 && args.splice(bailAt, 1).length > 0;
const coverageAt = args.indexOf("--coverage");
const coverage = coverageAt >= 0 && args.splice(coverageAt, 1).length > 0;
const FRAGMENTS_DIR = path.join(ROOT, "coverage/tmp/unit");
if (coverage) rmSync(FRAGMENTS_DIR, { recursive: true, force: true });
const filters = args.filter((a) => !a.startsWith("-"));

const all = TEST_ROOTS.flatMap(findTests).sort();
const files = filters.length ? all.filter((f) => filters.some((q) => f.includes(q))) : all;
if (files.length === 0) {
  console.error("[TEST] no test files matched", filters);
  process.exit(1);
}

const env = { ...process.env, IPFS_BACKEND: process.env.IPFS_BACKEND ?? "kubo", NODE_ENV: "test" };

/**
 * Whether a suite asked for a DOM with a `// @test-env dom` first line.
 * @param {string} file Test file relative to the repo root.
 */
function wantsDom(file) {
  return readFileSync(path.join(ROOT, file), "utf8").startsWith("// @test-env dom\n");
}

/** Kill a file that hangs rather than letting it stall the whole run. */
const FILE_TIMEOUT_MS = 120_000;

/** @typedef {{ file: string, code: number | null, out: string, ms: number }} FileResult */

/**
 * Runs one file; resolves with its outcome and captured output.
 * @param {string} file Test file relative to the repo root.
 * @param {number} index Position in the run (names its coverage fragment).
 * @returns {Promise<FileResult>}
 */
function runFile(file, index) {
  return new Promise((resolve) => {
    const started = Date.now();
    const preload = wantsDom(file) ? ["--preload", "./test/helpers/dom.js"] : [];
    const cov = coverage
      ? ["--coverage", "--coverage-reporter=lcov", `--coverage-dir=${path.join(FRAGMENTS_DIR, String(index))}`]
      : [];
    const child = spawn(process.execPath, ["test", ...preload, ...cov, `./${file}`], { cwd: ROOT, env });
    const timer = setTimeout(() => {
      out += `\n[TEST] killed after ${FILE_TIMEOUT_MS}ms (hung)\n`;
      child.kill("SIGKILL");
    }, FILE_TIMEOUT_MS);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ file, code, out, ms: Date.now() - started });
    });
  });
}

let next = 0;
let stopped = false;
/** @type {FileResult[]} */
const results = [];
async function worker() {
  while (!stopped && next < files.length) {
    const index = next++;
    const result = await runFile(files[index], index);
    results.push(result);
    console.log(`${result.code === 0 ? "PASS" : "FAIL"} ${result.file} (${result.ms}ms)`);
    if (result.code !== 0 && bail) stopped = true;
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

const failed = results.filter((r) => r.code !== 0);
let tests = 0;
let testFailures = 0;
for (const { out } of results) {
  tests += Number(/^\s*(\d+) pass/m.exec(out)?.[1] ?? 0);
  const fails = Number(/^\s*(\d+) fail/m.exec(out)?.[1] ?? 0);
  tests += fails;
  testFailures += fails;
}
for (const r of failed) console.log(`\n${"=".repeat(20)} ${r.file}\n${r.out}`);
console.log(
  `\nFiles: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total` +
    `\nTests: ${tests - testFailures} passed, ${testFailures} failed, ${tests} total`,
);
if (coverage) {
  const { lcovFragmentsToCoverageMap } = await import("./lcov-to-istanbul.mjs");
  const { writeCoverageReports } = await import("./write-coverage-reports.mjs");
  const map = lcovFragmentsToCoverageMap(FRAGMENTS_DIR, ROOT, (source) => {
    const rel = path.relative(ROOT, source);
    return !/(^|\/)(node_modules|test|e2e|blockchain|dist)\//.test(rel) && !rel.startsWith("frontend/dist");
  });
  writeCoverageReports(map, path.join(ROOT, "coverage/js"));
}
process.exit(failed.length === 0 ? 0 : 1);
