/**
 * Validation gates. Static gates never execute; kernel gates read stats only.
 * @remarks Environment-agnostic — the caller supplies the stats.
 */
import type { CadDesign, CadStats } from "../types.ts";
import { guardScript } from "./guard.ts";
import { referencedIdentifiers } from "./document.ts";

export interface GateResult {
  gate: string;
  ok: boolean;
  error?: string;
}

export interface KernelLimits {
  maxTriangles: number;
  /**
   * Most bodies the part may have; 1 when absent. More than one is the intent
   * for a print-in-place hinge or a clamp in two halves - see bodyAllowance.
   */
  maxBodies?: number;
  /**
   * Fewest bodies the part may have; 1 when absent. Above 1 only when the
   * request needs separate pieces that would be wrong fused - see bodyFloor.
   */
  minBodies?: number;
  /**
   * Most bodies one part of an ARRAY return may have; 1 when absent. Above 1
   * only for a part built by a multi-body helper - see bodyAllowance with no
   * piece count.
   */
  maxBodiesPerPart?: number;
}

/**
 * Library helpers that return several bodies BY CONSTRUCTION, and how many.
 * @remarks Deterministic, so a design that calls one is never failed for
 *   being what the helper is - whatever the request's wording led Jev to
 *   judge. attempt#17's hinge passed the old yes/no question at exactly 0.5.
 */
export const MULTI_BODY_HELPERS: Record<string, number> = { printInPlaceHinge: 2, pipeClamp: 2, boardCaseLid: 2 };

/**
 * How many bodies a design may have: Jev's piece count, raised to what any
 * multi-body helper it calls produces. A count of 5 means "5 or more", so no cap.
 * @param code The design's script. @param expectedPieces Jev's count, if asked.
 */
export function bodyAllowance(code: string, expectedPieces?: number): number {
  if (expectedPieces !== undefined && expectedPieces >= 5) return Number.POSITIVE_INFINITY;
  const called = referencedIdentifiers(code);
  const floor = Math.max(1, ...Object.entries(MULTI_BODY_HELPERS)
    .filter(([name]) => called.has(name)).map(([, n]) => n));
  return Math.max(floor, expectedPieces ?? 1);
}

/**
 * Jev's `pieces_separate` probability at or above which fewer bodies than its
 * piece count is a defect.
 * @remarks Measured live on 20 requests: fused-is-wrong 0.84-0.97 (two-half
 *   clamp, coasters, sliding or snap-fit lid, spacers), fused-may-be-fine
 *   0.05-0.65 (the highest a box with a hinged lid, which may be a living hinge).
 */
export const SEPARATE_THRESHOLD = 0.75;

/**
 * The fewest bodies a design may have: Jev's piece count, but only when Jev
 * also judged that one fused solid would be wrong for the request.
 * @remarks Fails open - with either answer missing, or a count of one, it is
 *   1, so a Jev outage never fails a part. A count of 5 ("5 or more") asks for
 *   at least 5.
 * @param expectedPieces Jev's count. @param piecesSeparate Jev's probability.
 */
export function bodyFloor(expectedPieces?: number, piecesSeparate?: number): number {
  if (expectedPieces === undefined || piecesSeparate === undefined) return 1;
  return piecesSeparate >= SEPARATE_THRESHOLD ? Math.max(1, expectedPieces) : 1;
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
  if (inside) {
    return "INSIDE the main body's bounds: it sits in a cavity or on a face and only TOUCHES it. " +
      "Faces that merely touch never fuse - extend it into the solid it rests on, or remove it";
  }
  const severedAxis = severedAlong(b, main);
  if (severedAxis !== undefined) {
    return "SEVERED: it spans the main body's full extent along " + severedAxis + ", side by side " +
      "with it - a cut (a slot, channel or groove) went ALL the way through and split the part. " +
      "Check every cut and hole: does it run along the right axis (a hole in a plate goes through " +
      "its THINNEST dimension), and is the cutter wider than the material it crosses? " +
      "Leave a floor or bridge of material across every cut instead of cutting it clean through; " +
      "do not move the pieces";
  }
  return "OUTSIDE the main body: it floats clear of it - move it so it overlaps the main body";
}

/**
 * The axis along which a loose body exactly matches the main body's extent.
 * @remarks The signature of a part a through-cut has split: a live cable clip
 *   cut its cable slots through the full height and came back as four fins,
 *   each spanning z -6..6 like the main one. "Move it so it overlaps" - the
 *   advice for a floating piece - cost both repair rounds; the fix is to leave
 *   material under the cut.
 */
function severedAlong(b: Box, main: Box): string | undefined {
  const tol = 0.05;
  const axis = [0, 1, 2].find((a) =>
    Math.abs(b.min[a] - main.min[a]) < tol && Math.abs(b.max[a] - main.max[a]) < tol &&
    b.max[a] - b.min[a] > tol);
  return axis === undefined ? undefined : "xyz"[axis];
}

/** The connected-gate failure, naming every loose piece so a repair can join it. */
function disconnectedError(bodies: NonNullable<CadStats["bodies"]>, allowed: number): string {
  const fmt = (v: number[]) => "[" + v.map((x) => x.toFixed(1)).join(", ") + "]";
  const main = bodies.boxes[0];
  const listed = bodies.boxes.map((b, i) =>
    "  body " + (i + 1) + (i === 0 ? " (main)" : "") + ": " + fmt(b.min) + " to " + fmt(b.max) +
    (i === 0 ? "" : " - " + whereLoose(b, main)));
  const want = allowed === 1 ? "one" : "at most " + allowed + " (the separate pieces the request asks for)";
  return "the part is " + bodies.count + " separate bodies, not " + want + " - a feature does not " +
    "touch the body it belongs to. Bounding boxes, largest first:\n" + listed.join("\n") + "\n" +
    "Make every feature OVERLAP the main body (by 0.5mm or more), not merely meet it: " +
    "remember every builder is centred on the origin, and use stack() to put parts end to end.";
}

/**
 * The pieces-gate failure: the request's separate pieces came out fused.
 * @remarks attempt#4's two-half pipe clamp came back as one block and passed,
 *   because the connected gate only caps bodies from above. The repair must
 *   SEPARATE, the opposite of the connected gate's "overlap" advice.
 */
function fusedError(count: number, wanted: number): string {
  const want = wanted >= 5 ? "5 or more" : String(wanted);
  return "the part is " + count + " bod" + (count === 1 ? "y" : "ies") + ", but the request needs " +
    want + " SEPARATE pieces that must not be fused (two clamp halves, a set of items, a lid that " +
    "comes off or slides). Pieces that touch or overlap merge into one body. Build each piece as " +
    "its own solid and return them as an array, one solid per piece, each where it sits in the " +
    "assembled object: return [pieceA, pieceB]. Parts in an array are never fused, so they may " +
    "touch. Do not join the pieces with a bridge, rib or pin; bolt holes that join them in use " +
    "go through each piece.";
}

/** The pieces-gate failure for an array return: too few parts in the array. */
function tooFewPartsError(count: number, wanted: number): string {
  const want = wanted >= 5 ? "5 or more" : String(wanted);
  return "the design returns " + count + " part" + (count === 1 ? "" : "s") + ", but the request " +
    "needs " + want + " SEPARATE pieces. Return one solid per piece in the array, each where it " +
    "sits in the assembled object: return [pieceA, pieceB].";
}

/** The connected-gate failure for an array return with more parts than allowed. */
function tooManyPartsError(count: number, allowed: number): string {
  return "the design returns " + count + " parts, but the request needs at most " + allowed +
    ". Combine features that belong to one piece into one solid before returning the array.";
}

/** The connected-gate failure for one array part that fell apart. */
function splitPartError(part: number, bodies: CadStats["bodies"]): string {
  const own = (bodies?.boxes ?? []).filter((b) => b.part === part);
  return "part " + part + " of the returned array " +
    disconnectedError({ count: own.length, boxes: own }, 1).slice("the part ".length);
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

/**
 * Caps bodies from above - or, for an array return, parts and each part's bodies.
 * @remarks Passes when the kernel reported no body count.
 */
function connectedGate(stats: CadStats, max: number, perPart: number): GateResult {
  const parts = stats.parts;
  if (parts?.array) {
    if (parts.count > max) return { gate: "connected", ok: false, error: tooManyPartsError(parts.count, max) };
    const split = parts.bodyCounts.findIndex((n) => n > perPart);
    return split === -1
      ? { gate: "connected", ok: true }
      : { gate: "connected", ok: false, error: splitPartError(split + 1, stats.bodies) };
  }
  const bodies = stats.bodies;
  return bodies === undefined || bodies.count <= max
    ? { gate: "connected", ok: true }
    : { gate: "connected", ok: false, error: disconnectedError(bodies, max) };
}

/**
 * Floors bodies from below - or, for an array return, parts.
 * @remarks Passes when the kernel reported no body count.
 */
function piecesGate(stats: CadStats, min: number): GateResult {
  const parts = stats.parts;
  if (parts?.array) {
    return parts.count >= min
      ? { gate: "pieces", ok: true }
      : { gate: "pieces", ok: false, error: tooFewPartsError(parts.count, min) };
  }
  const bodies = stats.bodies;
  return bodies === undefined || bodies.count >= min
    ? { gate: "pieces", ok: true }
    : { gate: "pieces", ok: false, error: fusedError(bodies.count, min) };
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

    connectedGate(stats, limits.maxBodies ?? 1, limits.maxBodiesPerPart ?? 1),
    piecesGate(stats, limits.minBodies ?? 1),

    stats.triangles <= limits.maxTriangles
      ? { gate: "budget", ok: true }
      : {
        gate: "budget", ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + limits.maxTriangles,
      },
  ];
}
