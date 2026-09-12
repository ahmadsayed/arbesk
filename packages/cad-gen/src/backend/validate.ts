/**
 * Validation of one attempt. Two entries, because the two hosts do different
 * jobs: `validateStatic` is the whole of server-side validation, and
 * `validateDesign` is the EVALUATION HARNESS - it runs the kernel and is not in
 * the request path.
 * @remarks The mesh is discarded in both — callers receive stats only.
 */
import type { CadDesign, CadStats } from "../types.ts";
import { evaluateStaticGates, evaluateKernelGates } from "../core/gates.ts";
import type { GateResult } from "../core/gates.ts";
import { runValidation } from "./validate-runner.ts";
import type { RunnerOptions } from "./validate-runner.ts";

export interface ValidateOptions {
  preludeNames: Iterable<string>;
  limits: RunnerOptions;
}

export interface ValidationOutcome {
  ok: boolean;
  stats?: CadStats;
  gates: GateResult[];
  error?: string;
}

/**
 * Runs the static gates - the whole of server-side validation.
 * @remarks The server does not run the kernel in the request path any more. Not
 *   a reduction in coverage but a correction of WHERE the check belongs: a
 *   server-side run evaluates a PROXY at a different fidelity, and the two
 *   provably disagree. Measured: an 80x60x8 plate with six 5mm holes and a 2mm
 *   edge fillet is 15,466 triangles at the validation profile and 245,652 at
 *   delivery fidelity, against a 200,000 budget - the proxy passes what the real
 *   part fails. A host that builds the mesh is the only authority on whether it
 *   builds, and the client is that host. It reports failures back for repair.
 */
export function validateStatic(
  design: CadDesign,
  preludeNames: Iterable<string>,
): ValidationOutcome {
  const gates = evaluateStaticGates(design, preludeNames);
  const failure = gates.find((g) => !g.ok);
  return failure ? { ok: false, gates, error: failure.error } : { ok: true, gates };
}

/**
 * Validates a design end to end, including a kernel run.
 * @remarks EVALUATION HARNESS ONLY - never call this from a request path. It
 *   spawns a child process and loads manifold.wasm, which is the most expensive
 *   step in the pipeline (91% of it, measured). Static failures short-circuit
 *   before the kernel runs, so a script the guard rejects never costs a spawn.
 */
export async function validateDesign(
  design: CadDesign,
  opts: ValidateOptions,
): Promise<ValidationOutcome> {
  const gates = evaluateStaticGates(design, opts.preludeNames);
  const staticFailure = gates.find((g) => !g.ok);
  if (staticFailure) {
    return { ok: false, gates, error: staticFailure.error };
  }

  const run = await runValidation(design, opts.limits);
  if (!run.ok) {
    gates.push({ gate: "kernel", ok: false, error: run.error });
    return { ok: false, gates, error: run.error };
  }

  gates.push({ gate: "kernel", ok: true });
  const kernelGates = evaluateKernelGates(run.stats, opts.limits);
  gates.push(...kernelGates);
  const kernelFailure = kernelGates.find((g) => !g.ok);
  if (kernelFailure) {
    return { ok: false, gates, error: kernelFailure.error, stats: run.stats };
  }

  return { ok: true, gates, stats: run.stats };
}
