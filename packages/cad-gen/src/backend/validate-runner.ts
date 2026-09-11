/**
 * Parent side of kernel validation: spawn a fresh child per attempt, enforce a
 * hard timeout, return stats only.
 * @remarks The mesh never crosses the process boundary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CadDesign, CadStats } from "../types.ts";

export interface RunnerOptions {
  /** Hard wall-clock limit for one attempt. */
  timeoutMs: number;
  /** Reject meshes above this triangle count. */
  maxTriangles: number;
  /**
   * Directory holding manifold.wasm.
   * @remarks The host supplies it (PROJECT_ROOT-relative): a compiled single-file
   *   binary cannot resolve node_modules from its virtual module URL.
   */
  wasmDir?: string;
}

export type RunnerResult =
  | { ok: true; stats: CadStats }
  | { ok: false; error: string };

/**
 * Directory holding the Emscripten glue and manifold.wasm.
 * @remarks Overridable because the compiled single-file server cannot resolve
 *   node_modules from a virtual module URL — there the path is PROJECT_ROOT
 *   relative, exactly like the brotli-wasm shim in scripts/build-server.mjs.
 */
function resolveWasmDir(opts: RunnerOptions): string {
  if (opts.wasmDir) return opts.wasmDir;
  const override = process.env.CAD_MANIFOLD_WASM_DIR;
  if (override) return override;
  // cwd-relative, never import.meta.url-relative: inside a compiled binary the
  // module URL is virtual, so an ascent from it lands on /$bunfs/... and ENOENTs.
  // Verified in Task 1 - see docs/superpowers/plans/cad-spike-results.md.
  return path.resolve(process.cwd(), "node_modules", "manifold-3d");
}

/**
 * Bytes of child output retained per stream.
 * @remarks Only the child's last stdout line is ever read, so a tail is enough.
 *   This cap is also what makes "stats only" hold *by construction*: mesh bytes
 *   cannot fit through a 16 KB window, so there is deliberately no separate
 *   mesh-size guard here. Do not add one — it would be unreachable defence.
 */
const MAX_CAPTURED_OUTPUT = 16 * 1024;

/**
 * Appends a chunk while keeping only the trailing window.
 * @remarks The child's output is untrusted. `console` is on the guard's
 *   allow-list, so a design may legally log inside a large loop (the guard only
 *   denies the literal `while (true)` / `for (;;)` forms — a counting loop
 *   passes). Buffering that unboundedly is a denial of service against the
 *   *server*: measured ~2 GB of parent heap in 3 s from one flooding child,
 *   ending in a RangeError thrown inside the stream handler. Capping the tail
 *   keeps the last line intact, which is all the protocol needs.
 */
function appendTail(buffer: string, chunk: string): string {
  if (buffer.length + chunk.length <= MAX_CAPTURED_OUTPUT) return buffer + chunk;
  return (buffer + chunk).slice(-MAX_CAPTURED_OUTPUT);
}

/** Best-effort removal of a validation temp directory. */
function removeDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Creates the temp directory and writes the child's request into it.
 * @remarks Failing here is a *host* fault (unwritable or full tmpdir), so it is
 *   reported through the same {ok:false} shape as every other host fault
 *   instead of throwing out of a function that promises a result.
 */
function prepareRequest(payload: unknown): { dir: string } | { error: string } {
  let dir: string;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-validate-"));
  } catch (e) {
    return { error: "kernel host unavailable: " + (e as Error).message };
  }
  try {
    fs.writeFileSync(path.join(dir, "request.json"), JSON.stringify(payload));
  } catch (e) {
    removeDir(dir);
    return { error: "kernel host unavailable: " + (e as Error).message };
  }
  return { dir };
}

/** True for a plain object (what JSON.parse yields for the child's line). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a finite number (a bounding-box coordinate may be negative). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True for a finite, non-negative number — the only valid count or volume. */
function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/** True for exactly three finite numbers, the tuple CadStats.bboxMm requires. */
function isTriple(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

/** Fillet strategies CadStats.filletMode may report. */
const FILLET_MODES = new Set(["exact", "minkowski", "smooth"]);

/** True when the three counts are present, finite and non-negative. */
function hasCounts(value: Record<string, unknown>): boolean {
  return isCount(value.triangles) && isCount(value.vertices) && isCount(value.volumeMm3);
}

/** True when both bounding-box corners are 3-number tuples. */
function hasBbox(value: unknown): boolean {
  return isRecord(value) && isTriple(value.min) && isTriple(value.max);
}

/** True when the fillet strategy is absent or one of the known ones. */
function isFilletMode(value: unknown): boolean {
  return value === undefined || FILLET_MODES.has(value as string);
}

/**
 * True when the child's reported stats have the shape CadStats promises.
 * @remarks The child runs model-written code, so its numbers are a claim. A
 *   malformed one must never reach the gates as though it had been measured.
 */
function isCadStats(value: unknown): value is CadStats {
  if (!isRecord(value) || !hasCounts(value)) return false;
  return hasBbox(value.bboxMm) && isFilletMode(value.filletMode);
}

/** The single rejection every unrecognised payload collapses to. */
function invalidResult(): RunnerResult {
  return { ok: false, error: "kernel host produced an invalid result" };
}

/** Narrows an ok:false payload to its non-empty string error. */
function errorResult(error: unknown): RunnerResult {
  if (typeof error === "string" && error.length > 0) return { ok: false, error };
  return invalidResult();
}

/** Re-applies the triangle budget to stats the child claims are within it. */
function applyBudget(stats: CadStats, maxTriangles: number): RunnerResult {
  if (stats.triangles > maxTriangles) {
    return { ok: false, error: "triangle budget exceeded: " + stats.triangles + " > " + maxTriangles };
  }
  return { ok: true, stats };
}

/** Validates the ok:true branch's stats, then applies the parent-side budget. */
function statsResult(raw: Record<string, unknown>, maxTriangles: number): RunnerResult {
  const stats = raw.stats;
  if (raw.ok !== true || !isCadStats(stats)) return invalidResult();
  return applyBudget(stats, maxTriangles);
}

/**
 * Validates one line of child output before the parent believes any of it.
 * @param maxTriangles Parent-side budget, re-applied here because the child's
 *   own check is self-reported by the same untrusted process.
 * @remarks Fail closed and never throw: the child is the untrusted executor, so
 *   an unrecognised payload is a host fault — not a crash, and not a partial
 *   trust. Extra keys are tolerated (forward compatibility); every field the
 *   gates read is re-checked.
 */
export function parseRunnerResult(raw: unknown, maxTriangles: number): RunnerResult {
  if (!isRecord(raw)) return invalidResult();
  if (raw.ok === false) return errorResult(raw.error);
  return statsResult(raw, maxTriangles);
}

/**
 * Runs one design in a fresh child process.
 * @remarks A non-zero exit or a missing stdout line means the *host* failed
 *   (the kernel could not load), which is distinct from a script-level failure.
 */
export function runValidation(design: CadDesign, opts: RunnerOptions): Promise<RunnerResult> {
  const childPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "child.ts");
  // In a compiled single-file server this path does not exist on disk. Fail
  // loudly rather than spawning a doomed process (ledger: parked finding on
  // compiled-server child execution).
  if (!fs.existsSync(childPath)) {
    return Promise.resolve({
      ok: false,
      error: "kernel host unavailable: validation child entry not found at " + childPath,
    });
  }
  const prepared = prepareRequest({
    design,
    maxTriangles: opts.maxTriangles,
    wasmDir: resolveWasmDir(opts),
  });
  if ("error" in prepared) return Promise.resolve({ ok: false, error: prepared.error });
  const { dir } = prepared;
  const requestPath = path.join(dir, "request.json");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [childPath, requestPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      removeDir(dir);
      resolve({ ok: false, error: "validation timed out after " + opts.timeoutMs + "ms" });
    }, opts.timeoutMs);

    child.stdout.on("data", (b) => { stdout = appendTail(stdout, String(b)); });
    child.stderr.on("data", (b) => { stderr = appendTail(stderr, String(b)); });

    // A spawn failure (EMFILE under load, a missing interpreter, ...) is
    // delivered as an 'error' event. With no listener Node rethrows it as an
    // uncaught exception and takes the whole server down, so the runner must
    // convert it into the same {ok:false} result every other host fault uses.
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeDir(dir);
      resolve({ ok: false, error: "kernel host failed: " + (e as Error).message });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeDir(dir);
      if (code !== 0) {
        resolve({ ok: false, error: "kernel host failed: " + (stderr.trim() || "exit " + code) });
        return;
      }
      const line = stdout.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        resolve({ ok: false, error: "kernel host produced no result" });
        return;
      }
      try {
        resolve(parseRunnerResult(JSON.parse(line), opts.maxTriangles));
      } catch {
        resolve({ ok: false, error: "kernel host produced unreadable output" });
      }
    });
  });
}
