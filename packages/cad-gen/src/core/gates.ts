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
  /**
   * The request asked for separate pieces - a print-in-place hinge, a clamp in
   * two halves - so more than one body is the intent, not a defect.
   */
  allowSeparateBodies?: boolean;
}

type Box = { min: [number, number, number]; max: [number, number, number] };

/**
 * Says how a loose body sits relative to the main one.
 * @remarks Two failures look identical in a body count and need opposite
 *   fixes. A piece INSIDE the main body's bounds is touching it face to face -
 *   attempt#10's Gridfinity base poked up into the bin's cavity and rested on
 *   the floor - and faces that only touch never fuse; it must overlap. A piece
 *   OUTSIDE is floating, and has to be moved, usually by a centring mistake.
 *   Two live repair rounds failed on the first case until it was named.
 */
function whereLoose(b: Box, main: Box): string {
  const inside = [0, 1, 2].every((a) => b.min[a] >= main.min[a] - 1e-6 && b.max[a] <= main.max[a] + 1e-6);
  return inside
    ? "INSIDE the main body's bounds: it sits in a cavity or on a face and only TOUCHES it. " +
      "Faces that merely touch never fuse - extend it into the solid it rests on, or remove it"
    : "OUTSIDE the main body: it floats clear of it - move it so it overlaps the main body";
}

/** The connected-gate failure, naming every loose piece so a repair can join it. */
function disconnectedError(bodies: NonNullable<CadStats["bodies"]>): string {
  const fmt = (v: number[]) => "[" + v.map((x) => x.toFixed(1)).join(", ") + "]";
  const main = bodies.boxes[0];
  const listed = bodies.boxes.map((b, i) =>
    "  body " + (i + 1) + (i === 0 ? " (main)" : "") + ": " + fmt(b.min) + " to " + fmt(b.max) +
    (i === 0 ? "" : " - " + whereLoose(b, main)));
  return "the part is " + bodies.count + " separate bodies, not one - a feature does not touch " +
    "the body it belongs to. Bounding boxes, largest first:\n" + listed.join("\n") + "\n" +
    "Make every feature OVERLAP the main body (by 0.5mm or more), not merely meet it: " +
    "remember every builder is centred on the origin, and use stack() to put parts end to end.";
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

    stats.bodies === undefined || stats.bodies.count <= 1 || limits.allowSeparateBodies === true
      ? { gate: "connected", ok: true }
      : { gate: "connected", ok: false, error: disconnectedError(stats.bodies) },

    stats.triangles <= limits.maxTriangles
      ? { gate: "budget", ok: true }
      : {
        gate: "budget", ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + limits.maxTriangles,
      },
  ];
}
