/** Validation gates. Static gates never execute; kernel gates read stats only. */
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
  /** Most bodies the part may have; 1 when absent (see bodyAllowance). */
  maxBodies?: number;
  /** Fewest bodies the part may have; 1 when absent (see bodyFloor). */
  minBodies?: number;
  /** Most bodies one part of an array return may have; 1 when absent. */
  maxBodiesPerPart?: number;
}

/** Helpers that return several bodies by construction, so they are never failed for it. */
export const MULTI_BODY_HELPERS: Record<string, number> = { printInPlaceHinge: 2, pipeClamp: 2, boardCaseLid: 2 };

/**
 * Jev's piece count, raised to what any multi-body helper produces. A count of
 * 5 means "5 or more", so no cap.
 */
export function bodyAllowance(code: string, expectedPieces?: number): number {
  if (expectedPieces !== undefined && expectedPieces >= 5) return Number.POSITIVE_INFINITY;
  const called = referencedIdentifiers(code);
  const floor = Math.max(1, ...Object.entries(MULTI_BODY_HELPERS)
    .filter(([name]) => called.has(name)).map(([, n]) => n));
  return Math.max(floor, expectedPieces ?? 1);
}

/**
 * Jev's `pieces_separate` probability at which too few bodies is a defect.
 * Measured: fused-is-wrong cases scored 0.84-0.97, fused-may-be-fine 0.05-0.65.
 */
export const SEPARATE_THRESHOLD = 0.75;

/**
 * Jev's piece count, but only when Jev also judged one fused solid wrong.
 * Fails open: any missing answer gives 1, so a Jev outage never fails a part.
 */
export function bodyFloor(expectedPieces?: number, piecesSeparate?: number): number {
  if (expectedPieces === undefined || piecesSeparate === undefined) return 1;
  return piecesSeparate >= SEPARATE_THRESHOLD ? Math.max(1, expectedPieces) : 1;
}

type Box = { min: [number, number, number]; max: [number, number, number] };

/**
 * A loose body inside the main body's bounds is touching and must overlap; one
 * outside is floating and must move. Same count, opposite fixes.
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
 * The axis along which a loose body exactly matches the main body's extent:
 * the sign of a through-cut that split the part.
 */
function severedAlong(b: Box, main: Box): string | undefined {
  const tol = 0.05;
  const axis = [0, 1, 2].find((a) =>
    Math.abs(b.min[a] - main.min[a]) < tol && Math.abs(b.max[a] - main.max[a]) < tol &&
    b.max[a] - b.min[a] > tol);
  return axis === undefined ? undefined : "xyz"[axis];
}

const fmt = (v: number[]) => "[" + v.map((x) => x.toFixed(1)).join(", ") + "]";

function disconnectedError(bodies: NonNullable<CadStats["bodies"]>, allowed: number): string {
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

/** The pieces-gate failure: separate pieces came out fused, so the repair must separate them. */
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

function tooFewPartsError(count: number, wanted: number): string {
  const want = wanted >= 5 ? "5 or more" : String(wanted);
  return "the design returns " + count + " part" + (count === 1 ? "" : "s") + ", but the request " +
    "needs " + want + " SEPARATE pieces. Return one solid per piece in the array, each where it " +
    "sits in the assembled object: return [pieceA, pieceB].";
}

function tooManyPartsError(count: number, allowed: number): string {
  return "the design returns " + count + " parts, but the request needs at most " + allowed +
    ". Combine features that belong to one piece into one solid before returning the array.";
}

function splitPartError(part: number, bodies: CadStats["bodies"]): string {
  const own = (bodies?.boxes ?? []).filter((b) => b.part === part);
  return "part " + part + " of the returned array " +
    disconnectedError({ count: own.length, boxes: own }, 1).slice("the part ".length);
}

/** Handed straight to the model as the repair instruction, so it names likely causes. */
const EMPTY_MESH_ERROR = "mesh has no triangles - the operation removed the whole part" +
  " (check hole, boltCircle, fillet and chamfer sizes against the part dimensions)";

/**
 * Compiles the body with the kernel's signature, without calling it, so a
 * syntax error fails on the server. Must match `compileScript` in kernel.ts.
 */
function parseError(code: string, preludeNames: Iterable<string>): string | undefined {
  try {
    new Function("PARAMETERS", "P", "M", ...preludeNames, code);
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}

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

/** Caps bodies (or, for an array return, parts and bodies per part); passes with no count. */
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

/** Floors bodies (or parts); passes with no count. */
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

/** Fails a sealed cavity, which the kernel reports as a void rather than a body. */
function sealedGate(stats: CadStats): GateResult {
  const voids = stats.voids;
  if (voids === undefined || voids.count === 0) return { gate: "sealed", ok: true };
  const listed = voids.boxes.map((b, i) =>
    "  void " + (i + 1) + (b.part ? " (part " + b.part + ")" : "") + ": " + fmt(b.min) + " to " + fmt(b.max));
  return {
    gate: "sealed", ok: false,
    error: "the part has " + voids.count + " cavit" + (voids.count === 1 ? "y" : "ies") + " sealed inside " +
      "the part - a cut (a hollow, pocket or hole) lies entirely within the solid and never reaches a " +
      "face, leaving a hidden void. Bounding boxes:\n" + listed.join("\n") + "\n" +
      "If the cut should be open, extend it through the face it should open from (a pocket or hollow " +
      "usually opens through the top or bottom face: make it reach that face and pass 0.5mm beyond); " +
      "if the part should be solid there, remove the cut.",
  };
}

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
    sealedGate(stats),

    stats.triangles <= limits.maxTriangles
      ? { gate: "budget", ok: true }
      : {
        gate: "budget", ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + limits.maxTriangles,
      },
  ];
}
