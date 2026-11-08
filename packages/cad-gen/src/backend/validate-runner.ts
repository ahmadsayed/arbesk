/**
 * Parent side of kernel validation: a fresh child per attempt, a hard timeout,
 * stats only. The mesh never crosses the process boundary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CadDesign, CadStats } from "../types.ts";

export interface RunnerOptions {
  timeoutMs: number;
  maxTriangles: number;
  /** Supplied by the host: a compiled single-file binary cannot resolve node_modules. */
  wasmDir?: string;
  /** 0 = adaptive. */
  segments?: number;
  /** Degrees. */
  minAngle?: number;
  /** mm. */
  minEdgeLength?: number;
}

/**
 * Coarser than delivery (twice the kernel's adaptive defaults): validation only
 * asks whether the solid is valid and roughly right, and this ran 12x faster for
 * a 0.24% volume change. segments must be 0, or it overrides the adaptive controls.
 */
const VALIDATION_FIDELITY = { segments: 0, minAngle: 20, minEdgeLength: 2 } as const;

export type RunnerResult =
  | { ok: true; stats: CadStats }
  | { ok: false; error: string };

/** Overridable because a compiled single-file server cannot resolve node_modules. */
function resolveWasmDir(opts: RunnerOptions): string {
  if (opts.wasmDir) return opts.wasmDir;
  const override = process.env.CAD_MANIFOLD_WASM_DIR;
  if (override) return override;
  // cwd-relative: inside a compiled binary import.meta.url is virtual (/$bunfs/...).
  return path.resolve(process.cwd(), "node_modules", "manifold-3d");
}

/**
/**
 * Only the last stdout line is read. The cap also makes "stats only" hold by
 * construction: a mesh cannot fit through it, so no separate mesh-size guard.
 */
const MAX_CAPTURED_OUTPUT = 16 * 1024;

/** Keeps a trailing window: an untrusted child can log in a loop and exhaust the parent's heap. */
function appendTail(buffer: string, chunk: string): string {
  if (buffer.length + chunk.length <= MAX_CAPTURED_OUTPUT) return buffer + chunk;
  return (buffer + chunk).slice(-MAX_CAPTURED_OUTPUT);
}

function removeDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Writes the child's request; a failure is a host fault, returned as {ok:false}. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isTriple(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

const FILLET_MODES = new Set(["exact", "minkowski", "smooth"]);

function hasCounts(value: Record<string, unknown>): boolean {
  return isCount(value.triangles) && isCount(value.vertices) && isCount(value.volumeMm3);
}

function hasBbox(value: unknown): boolean {
  return isRecord(value) && isTriple(value.min) && isTriple(value.max);
}

function isFilletMode(value: unknown): boolean {
  return value === undefined || FILLET_MODES.has(value as string);
}

/** The child runs model-written code, so its stats are a claim to check, not a measurement. */
function isCadStats(value: unknown): value is CadStats {
  if (!isRecord(value) || !hasCounts(value)) return false;
  return hasBbox(value.bboxMm) && isFilletMode(value.filletMode);
}

function invalidResult(): RunnerResult {
  return { ok: false, error: "kernel host produced an invalid result" };
}

function errorResult(error: unknown): RunnerResult {
  if (typeof error === "string" && error.length > 0) return { ok: false, error };
  return invalidResult();
}

/** Re-applies the triangle budget: the child's own check is self-reported. */
function applyBudget(stats: CadStats, maxTriangles: number): RunnerResult {
  if (stats.triangles > maxTriangles) {
    return { ok: false, error: "triangle budget exceeded: " + stats.triangles + " > " + maxTriangles };
  }
  return { ok: true, stats };
}

function statsResult(raw: Record<string, unknown>, maxTriangles: number): RunnerResult {
  const stats = raw.stats;
  if (raw.ok !== true || !isCadStats(stats)) return invalidResult();
  return applyBudget(stats, maxTriangles);
}

/**
 * Validates one line of child output. Fails closed and never throws; extra keys
 * are tolerated, every field the gates read is re-checked.
 */
export function parseRunnerResult(raw: unknown, maxTriangles: number): RunnerResult {
  if (!isRecord(raw)) return invalidResult();
  if (raw.ok === false) return errorResult(raw.error);
  return statsResult(raw, maxTriangles);
}

/** A non-zero exit or missing output line is a host failure, distinct from a script failure. */
export function runValidation(design: CadDesign, opts: RunnerOptions): Promise<RunnerResult> {
  const childPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "child.ts");
  // Not on disk in a compiled single-file server: fail rather than spawn a doomed child.
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
    segments: opts.segments ?? VALIDATION_FIDELITY.segments,
    minAngle: opts.minAngle ?? VALIDATION_FIDELITY.minAngle,
    minEdgeLength: opts.minEdgeLength ?? VALIDATION_FIDELITY.minEdgeLength,
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

    // Without a listener, a spawn 'error' event would crash the server.
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
