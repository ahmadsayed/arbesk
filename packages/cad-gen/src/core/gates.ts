/**
 * Validation gates. Static gates never execute; kernel gates read stats only.
 * @remarks Environment-agnostic — the caller supplies the stats.
 */
import type { CadDesign, CadStats } from "../types.ts";
import { guardScript } from "./guard.ts";

export interface GateResult {
  gate: string;
  ok: boolean;
  error?: string;
}

export interface KernelLimits {
  maxTriangles: number;
}

/**
 * The nonempty failure text.
 * @remarks This string *is* the repair instruction: it is handed straight back
 *   to the model on the next turn, so it names the cause rather than the
 *   symptom. A hole wider than the part, a fillet radius larger than the body
 *   and an over-sized bolt circle all arrive here as the same empty mesh.
 */
const EMPTY_MESH_ERROR = "mesh has no triangles - the operation removed the whole part" +
  " (check hole, boltCircle, fillet and chamfer sizes against the part dimensions)";

/**
 * Compiles the body with the kernel's exact signature, without calling it.
 * @remarks Static gating used to stop at the guard, so a body that does not
 *   even parse - attempt#1's hinge redeclared a const - passed every server
 *   gate and failed only in the client, costing a repair round trip. The
 *   parameter list must match `compileScript` in kernel.ts: redeclaring a
 *   parameter name (`const P = ...`) is itself a syntax error.
 * @returns The parser's message, or undefined when the body compiles.
 */
function parseError(code: string, preludeNames: Iterable<string>): string | undefined {
  try {
    // Compiled, never invoked: nothing in the body runs.
    new Function("PARAMETERS", "P", "M", ...preludeNames, code);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Gates that need no execution. Cheap enough to run before every attempt. */
export function evaluateStaticGates(
  design: CadDesign,
  preludeNames: Iterable<string>,
): GateResult[] {
  const gates: GateResult[] = [];

  const guard = guardScript(design.code, preludeNames);
  gates.push(guard.ok
    ? { gate: "guard", ok: true }
    : {
      gate: "guard", ok: false,
      error: guard.reason + (guard.detail ? ": " + guard.detail : ""),
    });

  const syntaxError = parseError(design.code, preludeNames);
  gates.push(syntaxError === undefined
    ? { gate: "syntax", ok: true }
    : { gate: "syntax", ok: false, error: "script does not parse: " + syntaxError });

  const usesParameters = /\bPARAMETERS\b|\bP\./.test(design.code);
  gates.push(usesParameters
    ? { gate: "parameters", ok: true }
    : {
      gate: "parameters", ok: false,
      error: "script must derive dimensions from PARAMETERS so parameters stay editable",
    });

  return gates;
}

/** Gates evaluated against a successful kernel run. */
export function evaluateKernelGates(stats: CadStats, limits: KernelLimits): GateResult[] {
  return [
    stats.triangles > 0
      ? { gate: "nonempty", ok: true }
      : { gate: "nonempty", ok: false, error: EMPTY_MESH_ERROR },

    stats.volumeMm3 > 0
      ? { gate: "volume", ok: true }
      : { gate: "volume", ok: false, error: "solid has no volume - the result is degenerate" },

    stats.triangles <= limits.maxTriangles
      ? { gate: "budget", ok: true }
      : {
        gate: "budget", ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + limits.maxTriangles,
      },
  ];
}
