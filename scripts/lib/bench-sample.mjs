/**
 * One CADPrompt sample through the shipped loop: generate, build with client
 * repair, score against ground truth.
 * @remarks Generator, kernel and scorer are injected, so outcome
 *   classification and the paper's penalty rule are testable without a
 *   provider or WASM. Scoring sits OUTSIDE the error classification on
 *   purpose: a scorer that throws is a harness bug, and must stop the run
 *   rather than be booked against the generator as a provider error.
 */
import { CadGenerationFailed, CadRequestUnsuitable } from "../../packages/cad-gen/src/errors.ts";
import { buildWithClientRepair } from "./client-repair.mjs";
import { PENALTY_DISTANCE } from "./mesh-metrics.mjs";

/** Per-sample wall clock. Enforced through generate()'s signal only. */
export const SAMPLE_TIMEOUT_MS = 10 * 60 * 1000;

/** What a sample that produced no part scores: paper section 5, plus IoU 0. */
export const PENALTY = Object.freeze({
  chamfer: PENALTY_DISTANCE, hausdorff: PENALTY_DISTANCE, iogt: 0, iou: 0, iouReason: null,
});

/** @typedef {{ prompt: number, completion: number }} Tokens */

/**
 * @param {Tokens} a @param {Tokens | undefined} b
 * @returns {Tokens}
 */
const addTokens = (a, b) => ({ prompt: a.prompt + (b?.prompt ?? 0), completion: a.completion + (b?.completion ?? 0) });

/**
 * Names why generation produced no design.
 * @param {unknown} error
 * @param {AbortSignal} signal The sample's wall-clock signal.
 * @returns {"timeout" | "refused" | "static_failed" | "provider_error"}
 */
export function classifyError(error, signal) {
  if (signal.aborted) return "timeout";
  if (error instanceof CadRequestUnsuitable) return "refused";
  if (error instanceof CadGenerationFailed) return "static_failed";
  return "provider_error";
}

/**
 * Runs one sample.
 * @param {{ generator: any, kernel: any,
 *   score: (mesh: any, truthPath: string) => any,
 *   sample: import("./cadprompt.mjs").Sample, timeoutMs?: number }} ctx
 * @returns {Promise<{ result: any, mesh: any }>} mesh is the delivered part,
 *   or null when none was built.
 */
export async function runSample(ctx) {
  const { sample } = ctx;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? SAMPLE_TIMEOUT_MS);
  /** @type {any} */
  const result = {
    id: sample.id, variant: sample.variant, prompt: sample.prompt, rewrite: sample.rewrite,
    suspect: sample.suspect, strata: sample.strata, groundTruth: sample.gtJson,
    outcome: "provider_error", error: null, design: null, diagnostics: null,
    clientFailures: [], firstPass: false, stats: null, metrics: { ...PENALTY },
    tokens: { prompt: 0, completion: 0 }, jevTokens: { prompt: 0, completion: 0 },
    durationMs: 0, triage: null,
  };
  /** @type {any} */
  let built;
  try {
    const first = await ctx.generator.generate({ prompt: sample.prompt, signal: controller.signal });
    result.diagnostics = first.diagnostics;
    result.tokens = addTokens(result.tokens, first.diagnostics?.tokens);
    result.jevTokens = addTokens(result.jevTokens, first.diagnostics?.selection?.jevTokens);
    built = await buildWithClientRepair(
      { generator: ctx.generator, kernel: ctx.kernel, prompt: sample.prompt, signal: controller.signal }, first);
    for (const r of built.results) result.tokens = addTokens(result.tokens, r.diagnostics?.tokens);
    result.design = built.design;
    result.clientFailures = built.failures;
  } catch (e) {
    result.outcome = classifyError(e, controller.signal);
    result.error = e instanceof Error ? e.message : String(e);
    if (e instanceof CadGenerationFailed) {
      result.tokens = addTokens(result.tokens, /** @type {any} */ (e.diagnostics)?.tokens);
    }
    return finish(result, null, started, timer);
  }
  if (!built.run) {
    const last = built.failures[built.failures.length - 1];
    result.outcome = last.gate === "kernel" ? "kernel_error" : "gate_failed";
    result.error = last.error;
    return finish(result, null, started, timer);
  }
  result.outcome = "built";
  result.firstPass = built.failures.length === 0;
  result.stats = built.run.stats;
  result.metrics = ctx.score(built.run.mesh, sample.gtStlPath);
  return finish(result, built.run.mesh, started, timer);
}

/**
 * Stamps the duration and releases the wall clock.
 * @param {any} result @param {any} mesh @param {number} started
 * @param {ReturnType<typeof setTimeout>} timer
 * @returns {{ result: any, mesh: any }}
 */
function finish(result, mesh, started, timer) {
  clearTimeout(timer);
  result.durationMs = Date.now() - started;
  return { result, mesh };
}
