/**
 * `validateStatic` is all of server-side validation; `validateDesign` runs the
 * kernel for the evaluation harness only. Callers receive stats, never meshes.
 */
import type { CadDesign, CadStats } from "../types.ts";
import { evaluateStaticGates, evaluateKernelGates } from "../core/gates.ts";
import type { GateResult } from "../core/gates.ts";
import { referencedIdentifiers } from "../core/document.ts";
import { missingRequiredHelpers } from "./catalog.ts";
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

/** Backend-only: the rule depends on the user's prompt, which the client gate never sees. */
function requiredHelpersGate(design: CadDesign, prompt: string): GateResult {
  const missing = missingRequiredHelpers(prompt, referencedIdentifiers(design.code));
  return missing.length === 0
    ? { gate: "required-helper", ok: true }
    : { gate: "required-helper", ok: false, error: missing.map((r) => r.error).join(" ") };
}

/**
 * The server does not run the kernel: its proxy run at validation fidelity
 * disagreed with the delivered part, so the client, which builds the mesh,
 * validates geometry and reports failures back.
 */
export function validateStatic(
  design: CadDesign,
  preludeNames: Iterable<string>,
  prompt?: string,
): ValidationOutcome {
  const gates = evaluateStaticGates(design, preludeNames);
  if (prompt !== undefined) gates.push(requiredHelpersGate(design, prompt));
  const failure = gates.find((g) => !g.ok);
  return failure ? { ok: false, gates, error: failure.error } : { ok: true, gates };
}

/** Evaluation harness only: spawns a child and loads manifold.wasm. */
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
