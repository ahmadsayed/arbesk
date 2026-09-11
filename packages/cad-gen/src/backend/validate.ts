/**
 * Full validation of one attempt: static gates, then a kernel run, then stats
 * gates.
 * @remarks The mesh is discarded here — callers receive stats only. The server
 *   validates; it does not export (spec section 5).
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
 * Validates a design.
 * @remarks Static failures short-circuit before the kernel runs, so a script
 *   the guard rejects never costs a process spawn.
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
