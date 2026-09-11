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
