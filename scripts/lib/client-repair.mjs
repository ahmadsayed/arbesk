/**
 * The browser worker's build loop, for the offline harnesses.
 * @remarks Moved out of scripts/cad-eval.mjs so cad-eval and cad-bench run the
 *   SAME client loop. The server never runs the kernel, so a design that throws
 *   in it - a helper refusing its arguments, say - can only be repaired by this
 *   round trip. Without it a harness reports failures a real client would fix.
 */
import { bodyAllowance, bodyFloor, evaluateKernelGates } from "../../packages/cad-gen/src/core/gates.ts";

/** The delivery triangle budget the browser worker enforces. */
export const MAX_TRIANGLES = 200000;

/** Client repair rounds after the first build, as the browser worker spends. */
export const CLIENT_REPAIR_ROUNDS = 2;

/** One failed build: `gate` is "kernel" when the script threw. @typedef {{ gate: string, error: string }} RoundFailure */

/**
 * Builds a design the way the browser worker does: run the kernel, and on a
 * failure send it back as a repair turn carrying the kernel's own error.
 * @param {{ generator: any, kernel: any, prompt: string, signal?: AbortSignal,
 *   onRepair?: (round: number, failure: RoundFailure) => void,
 *   onDesign?: (design: any) => void }} ctx Run context.
 * @param {any} first The first generation (a CadGenerateResult).
 * @returns {Promise<{ run: any, design: any, failures: RoundFailure[], results: any[] }>}
 *   `run` is null when every round failed; `failures` lists each failed build
 *   in order; `results` holds the repair generations, for token accounting.
 */
export async function buildWithClientRepair(ctx, first) {
  let design = first.design;
  // Jev's judgement from the FIRST call: a repair round skips Jev, and whether
  // the request wants separate pieces does not change between rounds.
  const { expectedPieces: pieces, piecesSeparate } = first.diagnostics.selection;
  const minBodies = bodyFloor(pieces, piecesSeparate);
  /** @type {RoundFailure[]} */
  const failures = [];
  /** @type {any[]} */
  const results = [];
  for (let round = 0; ; round++) {
    /** @type {RoundFailure} */
    let failure;
    try {
      const run = ctx.kernel.run(design);
      const maxBodies = bodyAllowance(design.code, pieces);
      const failed = evaluateKernelGates(run.stats, { maxTriangles: MAX_TRIANGLES, maxBodies, minBodies })
        .find((g) => !g.ok);
      if (!failed) return { run, design, failures, results };
      failure = { gate: failed.gate, error: failed.gate + ": " + failed.error };
    } catch (e) {
      failure = { gate: "kernel", error: e instanceof Error ? e.message : String(e) };
    }
    failures.push(failure);
    if (round >= CLIENT_REPAIR_ROUNDS) return { run: null, design, failures, results };
    ctx.onRepair?.(round + 1, failure);
    const repaired = await ctx.generator.generate({
      prompt: ctx.prompt, priorDesign: design,
      failures: [{ gate: "kernel", error: failure.error }],
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    results.push(repaired);
    design = repaired.design;
    ctx.onDesign?.(design);
  }
}
