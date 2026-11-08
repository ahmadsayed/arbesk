/**
 * The CAD prelude: the published helper API the model is prompted against.
 * Adding, removing or renaming a helper requires a PRELUDE_VERSION bump.
 */
import type { ManifoldModule } from "../types.ts";
import { knuckleHinge, printInPlaceHinge } from "./library/knuckle-hinge.ts";
import { spoolHolder } from "./library/spool-holder.ts";
import { gridfinityCup } from "./library/gridfinity-cup.ts";
import { wallHook } from "./library/wall-hook.ts";
import { extrusionSpoolArm } from "./library/extrusion-spool-arm.ts";
import { knob } from "./library/knob.ts";
import { pipeClamp } from "./library/pipe-clamp.ts";
import { rack } from "./library/gear-rack.ts";
import { bevelApexHeight, bevelGear } from "./library/bevel-gear.ts";
import { worm, wormDistance, wormGear } from "./library/worm-gear.ts";

export const PRELUDE_NAMES = [
  "box", "cylinder", "sphere",
  "rect", "circle", "roundRect", "polygon", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "spurGear", "ringGear", "rack", "gearDistance", "bevelGear", "bevelApex", "worm", "wormGear", "wormDistance", "gridfinityBase", "gridfinityBaseplate", "standoffs", "boardCase", "phoneStand", "railHook",
  "cupRack", "knuckleHinge", "printInPlaceHinge", "spoolHolder", "gridfinityCup", "wallHook", "knob", "gt2Pulley", "extrusionSpoolArm", "pipeClamp", "boardCaseLid", "stack",
  "filletEdges", "chamferEdges", "color",
  "bbox", "volume",
] as const;

export interface PreludeHelpers {
  readonly lastFilletMode?: "exact" | "minkowski" | "smooth";
  readonly lastFilletQuality?: FilletQuality;
  [name: string]: unknown;
}

/**
 * Ball tessellation for fillets. Draft is the default because cost scales
 * steeply with facets (1.0s at 8, 15.6s at 32) while volume moves under 1%.
 */
export type FilletQuality = "draft" | "high";

const DEFAULT_SEGMENTS = 64;

const HOOK_DEFAULTS = {
  railDiameter: 25, wall: 5, width: 20, clearance: 0.4, drop: 40, stem: 9,
};

const RACK_DEFAULTS = {
  cupDiameter: 85, clearance: 3, columns: 2, rows: 2, pocketDepth: 22, wall: 3,
};

/** The rail hook ring as one closed contour: outer arc out, inner arc back. */
function hookRing(inner: number, outer: number, sweep: number): number[][] {
  const steps = 60;
  const start = -60;
  const at = (i: number, r: number): number[] => {
    const a = ((start + (sweep * i) / steps) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const pts: number[][] = [];
  for (let i = 0; i <= steps; i++) pts.push(at(i, outer));
  for (let i = steps; i >= 0; i--) pts.push(at(i, inner));
  return pts;
}

const CASE_DEFAULTS = {
  boardLength: 85, boardWidth: 56, wall: 2.5, floor: 2.5, clearance: 2,
  standoff: 4, height: 18, cornerRadius: 3, standoffDiameter: 6, screw: 2.4,
  holes: [] as number[][], cutouts: [] as any[],
};

/** ISO 53 20-degree full-depth proportions; gears only mesh if both use them. */
const GEAR_ADDENDUM = 1;
const GEAR_DEDENDUM = 1.25;
/**
 * Gridfinity compatibility constants, quoted from gridfinity.xyz/specification.
 * Not tunable: a base that is slightly off does not seat in other baseplates.
 */
const GF_GRID = 42;
/** Per-side clearance: a 1x1 footprint is 41.5, not 42. */
const GF_CLEARANCE = 0.25;
/** Base profile, bottom to top: 45-degree taper, riser, 45-degree taper. */
const GF_TAPER_BOTTOM = 0.8;
const GF_RISER = 1.8;
const GF_TAPER_TOP = 2.15;
const GF_BASE_HEIGHT = GF_TAPER_BOTTOM + GF_RISER + GF_TAPER_TOP;
const GF_CORNER_RADIUS = 3.75;
/** The baseplate pocket: the bin profile with a 0.7mm bottom taper and R4 corners. */
const GF_PLATE_TAPER_BOTTOM = 0.7;
const GF_PLATE_HEIGHT = GF_PLATE_TAPER_BOTTOM + GF_RISER + GF_TAPER_TOP;
const GF_PLATE_CORNER_RADIUS = 4;

const GEAR_FLANK_STEPS = 8;

/** Slices per full turn of a helical twist, as BOSL2. */
const GEAR_HELIX_SEGMENTS = 64;

function baseplateUnits(opts: any): [number, number] {
  const ux = opts?.unitsX ?? 1;
  const uy = opts?.unitsY ?? ux;
  if (!Number.isInteger(ux) || !Number.isInteger(uy) || ux < 1 || uy < 1) {
    throw new Error("gridfinityBaseplate needs whole unitsX and unitsY of at least 1");
  }
  return [ux, uy];
}

function gridCentres(ux: number, uy: number): [number, number][] {
  const out: [number, number][] = [];
  for (let ix = 0; ix < ux; ix++) {
    for (let iy = 0; iy < uy; iy++) {
      out.push([(ix - (ux - 1) / 2) * GF_GRID, (iy - (uy - 1) / 2) * GF_GRID]);
    }
  }
  return out;
}

const involute = (a: number): number => Math.tan(a) - a;

interface GearRadii {
  pitch: number;
  base: number;
  tip: number;
  root: number;
}

/**
 * Tooth height follows the normal module while the pitch circle uses the
 * transverse one, as in BOSL2.
 */
function gearRadii(m: number, z: number, phi: number, normalModule: number = m, internal = false): GearRadii {
  const pitch = (m * z) / 2;
  // An internal gear's tooth spaces are an external gear's teeth.
  const out = internal ? GEAR_DEDENDUM : GEAR_ADDENDUM;
  const inward = internal ? GEAR_ADDENDUM : GEAR_DEDENDUM;
  return {
    pitch,
    base: pitch * Math.cos(phi),
    tip: pitch + out * normalModule,
    root: pitch - inward * normalModule,
  };
}

/** Transverse module and pressure angle: both grow by 1/cos(helix) (BOSL2). */
function transverseGear(
  m: number, pressureAngle: number | undefined, helical: number, caller: string,
): { mt: number; phi: number } {
  if (!(Math.abs(helical) < 90)) throw new Error(caller + " needs a helical angle between -90 and 90 degrees");
  const beta = (helical * Math.PI) / 180;
  return {
    mt: m / Math.cos(beta),
    phi: Math.atan(Math.tan(((pressureAngle ?? 20) * Math.PI) / 180) / Math.cos(beta)),
  };
}

/**
 * Half the angular width of one tooth at radius r: the involute taper,
 * inv(a) - inv(phi), is what lets two gears turn at a constant ratio.
 */
function halfToothAngle(r: number, radii: GearRadii, z: number, phi: number): number {
  const clamped = Math.max(r, radii.base);
  const alpha = Math.acos(Math.min(1, radii.base / clamped));
  return Math.PI / (2 * z) + involute(phi) - involute(alpha);
}

/** One tooth's outline, CCW; below the base circle the flank runs radially to the root. */
function toothPoints(
  i: number,
  z: number,
  phi: number,
  radii: GearRadii,
  steps: number,
): number[][] {
  const pitchAngle = (2 * Math.PI) / z;
  const centre = i * pitchAngle;
  const at = (r: number, a: number): number[] => [r * Math.cos(a), r * Math.sin(a)];
  const rootAngle = halfToothAngle(radii.base, radii, z, phi);
  const radiusAt = (s: number): number =>
    radii.base + (radii.tip - radii.base) * (s / steps);
  const pts: number[][] = [at(radii.root, centre - rootAngle)];

  for (let s = 0; s <= steps; s++) {
    pts.push(at(radiusAt(s), centre - halfToothAngle(radiusAt(s), radii, z, phi)));
  }
  pts.push(at(radii.tip, centre));
  for (let s = steps; s >= 0; s--) {
    pts.push(at(radiusAt(s), centre + halfToothAngle(radiusAt(s), radii, z, phi)));
  }
  pts.push(at(radii.root, centre + rootAngle), at(radii.root, centre + pitchAngle / 2));
  return pts;
}

/**
 * BOSL2's helical construction. OpenSCAD twists clockwise, so Manifold gets
 * the negative twist, turned back by half so the mid-plane is untwisted.
 */
function helicalExtrude(
  Manifold: any, section: any, thickness: number, pitchRadius: number, helical: number, herringbone: boolean,
): any {
  const twist = (360 * thickness * Math.tan((helical * Math.PI) / 180)) / (2 * Math.PI * pitchRadius);
  if (twist === 0) return Manifold.extrude(section, thickness, 0, 0, [1, 1], true);
  const slices = Math.ceil((Math.abs(twist) / 360) * GEAR_HELIX_SEGMENTS) + 1;
  if (herringbone) {
    const half = Manifold.extrude(section, thickness / 2, Math.ceil(slices / 2), -twist / 2, [1, 1], false);
    return half.add(half.mirror([0, 0, 1]));
  }
  return Manifold.extrude(section, thickness, slices, -twist, [1, 1], true).rotate([0, 0, twist / 2]);
}

function assertGearSpec(m: number, z: number, thickness: number, bore: number, root: number): void {
  if (!(m > 0)) throw new Error("spurGear needs a positive module");
  if (!(z >= 3)) throw new Error("spurGear needs at least 3 teeth");
  if (!(thickness > 0)) throw new Error("spurGear needs a positive thickness");
  if (bore > 0 && bore / 2 >= root) {
    throw new Error("spurGear: a " + bore + " bore does not fit inside the root diameter of " +
      (2 * root).toFixed(2));
  }
}

function assertRingGearBasics(o: any): void {
  if (!(o.module > 0)) throw new Error("ringGear needs a positive module");
  if (!Number.isInteger(o.teeth) || o.teeth < 4) throw new Error("ringGear needs a whole number of teeth, at least 4");
  if (!(o.thickness > 0)) throw new Error("ringGear needs a positive thickness");
  if (o.backing !== undefined && o.outerDiameter !== undefined) {
    throw new Error("ringGear takes backing or outerDiameter, not both");
  }
}

/** BOSL2's default ring outer radius is 2 x (pitch + dedendum) - (pitch - addendum). */
function ringOuterRadius(o: any, radii: GearRadii): number {
  const outer = o.outerDiameter !== undefined ? o.outerDiameter / 2
    : o.backing !== undefined ? radii.tip + o.backing
      : 2 * radii.tip - radii.root;
  if (!(outer > radii.tip)) {
    throw new Error("ringGear: the outer diameter must clear the tooth roots (" + (2 * radii.tip).toFixed(2) + " mm)");
  }
  return outer;
}

/** teeth1 is the ring in an internal mesh, so it must exceed teeth2 (as BOSL2's gear_dist()). */
function assertGearDistanceSpec(o: any): void {
  if (!(o.module > 0)) throw new Error("gearDistance needs a positive module");
  if (!Number.isInteger(o.teeth1) || o.teeth1 < 4) {
    throw new Error("gearDistance needs a whole number of teeth1, at least 4");
  }
  if (!Number.isInteger(o.teeth2) || o.teeth2 < 4) {
    throw new Error("gearDistance needs a whole number of teeth2, at least 4");
  }
  if (o.internal && !(o.teeth1 > o.teeth2)) {
    throw new Error("gearDistance needs teeth1 > teeth2 for an internal mesh (teeth1 is the ring)");
  }
}

/**
 * BOSL2's gear_dist() at profile shift 0 and backlash 0: mt x (z1 +/- z2) / 2.
 * A formula is a fact, so it carries no credit.
 */
function gearDistanceBetween(o: any): number {
  assertGearDistanceSpec(o);
  const { mt } = transverseGear(o.module, undefined, o.helical ?? 0, "gearDistance");
  const halfTeeth = o.internal ? (o.teeth1 - o.teeth2) / 2 : (o.teeth1 + o.teeth2) / 2;
  return mt * halfTeeth;
}

function spurOutlinePoints(
  m: number, z: number, phi: number, steps: number, normalModule: number = m, internal = false,
): number[][] {
  const radii = gearRadii(m, z, phi, normalModule, internal);
  const points: number[][] = [];
  for (let i = 0; i < z; i++) {
    for (const p of toothPoints(i, z, phi, radii, steps)) points.push(p);
  }
  return points;
}

/**
 * spurGear's involute tooth laid out as BOSL2's bevel_gear() sweeps it. The
 * flank starts at the root when that lies outside the base circle, so the
 * swept outline never self-overlaps.
 */
function bevelToothPoints(m: number, z: number, pressureAngle: number): number[][] {
  return centredToothPoints(m, z, pressureAngle, 0, true);
}

/** worm_gear() splits the tooth into two flanks, so there is no single tip point. */
function wormToothPoints(m: number, z: number, pressureAngle: number, helical: number): number[][] {
  return centredToothPoints(m, z, pressureAngle, helical, false);
}

/** A tooth centred on +Y with its pitch point at the origin, +X root first. */
function centredToothPoints(m: number, z: number, pressureAngle: number, helical: number, tipPoint: boolean): number[][] {
  const { mt, phi } = transverseGear(m, pressureAngle, helical, "gear tooth");
  const radii = gearRadii(mt, z, phi, m);
  const start = Math.max(radii.base, radii.root);
  const steps = GEAR_FLANK_STEPS;
  const half = (r: number): number => Math.max(0, halfToothAngle(r, radii, z, phi));
  const at = (r: number, a: number): number[] => [r * Math.cos(a), r * Math.sin(a) - radii.pitch];
  const flank = Array.from({ length: steps + 1 }, (_v, s) => start + ((radii.tip - start) * s) / steps);
  const up = Math.PI / 2;
  const pts: number[][] = [at(radii.root, up - Math.PI / z)];
  if (radii.root < radii.base) pts.push(at(radii.root, up - half(radii.base)));
  for (const r of flank) pts.push(at(r, up - half(r)));
  if (tipPoint) pts.push(at(radii.tip, up));
  for (const r of [...flank].reverse()) pts.push(at(r, up + half(r)));
  if (radii.root < radii.base) pts.push(at(radii.root, up + half(radii.base)));
  pts.push(at(radii.root, up + Math.PI / z));
  return pts;
}

// GT2 (Gates PowerGrip GT, 2mm pitch) published standard dimensions.
const GT2_PITCH = 2;
/** Outside diameter = pitch diameter - 2 x 0.254 (20 teeth: 12.73 pitch, 12.22 OD). */
const GT2_PITCH_FACTOR = 0.254;
const GT2_GROOVE_DEPTH = 0.76;
const GT2_VALLEY_FLAT = 0.45;
const GT2_HALF_ANGLE = (20 * Math.PI) / 180;

function gt2ScrewDiameter(screw: unknown): number {
  const dia = ({ none: 0, M3: 3.4, M4: 4.5 } as Record<string, number>)[screw as string] ?? 0;
  if (dia === 0 && screw !== "none") {
    throw new Error('gt2Pulley: setScrew is "none", "M3" or "M4"');
  }
  return dia;
}

function assertGt2Spec(z: number, width: number, bore: number, rRoot: number, flangeD: number): void {
  if (!(z >= 8)) throw new Error("gt2Pulley needs at least 8 teeth");
  if (!(width > 0)) throw new Error("gt2Pulley needs a positive beltWidth");
  if (!(bore > 0) || bore / 2 >= rRoot - 1) {
    throw new Error("gt2Pulley: a " + bore + " mm bore leaves no hub inside the " +
      (2 * rRoot).toFixed(2) + " mm root diameter");
  }
  if (flangeD <= bore) throw new Error("gt2Pulley: flangeDiameter must clear the bore");
}

interface Gt2Spec {
  teeth: number;
  beltWidth: number;
  bore: number;
  flanges: boolean;
  flangeThickness: number;
  flangeDiameter: number;
  screwDiameter: number;
  rOut: number;
  rRoot: number;
  total: number;
}

function resolveGt2Spec(o: any): Gt2Spec {
  const {
    teeth = 20,
    beltWidth = 6,
    bore = 5,
    flanges = true,
    flangeThickness = 1,
    setScrew = "none",
  } = o ?? {};
  const rOut = ((GT2_PITCH * teeth) / Math.PI - 2 * GT2_PITCH_FACTOR) / 2;
  const rRoot = rOut - GT2_GROOVE_DEPTH;
  const flangeDiameter = o.flangeDiameter ?? 2 * rOut + 2;
  assertGt2Spec(teeth, beltWidth, bore, rRoot, flangeDiameter);
  const screwDiameter = gt2ScrewDiameter(setScrew);
  if (screwDiameter > 0 && screwDiameter >= bore) {
    throw new Error("gt2Pulley: a set screw needs a bore bigger than " + screwDiameter + " mm");
  }
  return {
    teeth, beltWidth, bore, flanges, flangeThickness, flangeDiameter,
    screwDiameter, rOut, rRoot,
    total: beltWidth + 2 * flangeThickness,
  };
}

/**
 * The straight-flanked printable approximation of the GT2 groove: six points
 * per tooth so consecutive points never span a groove.
 */
function gt2OutlinePoints(teeth: number): number[][] {
  const z = teeth;
  const pitchDia = (GT2_PITCH * z) / Math.PI;
  const rOut = (pitchDia - 2 * GT2_PITCH_FACTOR) / 2;
  const rRoot = rOut - GT2_GROOVE_DEPTH;
  const flankArc = GT2_GROOVE_DEPTH * Math.tan(GT2_HALF_ANGLE);
  const land = GT2_PITCH - 2 * flankArc - GT2_VALLEY_FLAT;
  const at = (r: number, a: number): number[] => [r * Math.cos(a), r * Math.sin(a)];
  const arc = (mm: number): number => mm / rOut;
  const points: number[][] = [];
  for (let i = 0; i < z; i++) {
    const c = (i * 2 * Math.PI) / z;
    points.push(
      at(rOut, c),
      at(rOut, c + arc(land / 2)),
      at(rRoot, c + arc(land / 2 + flankArc)),
      at(rRoot, c + arc(land / 2 + flankArc + GT2_VALLEY_FLAT / 2)),
      at(rRoot, c + arc(land / 2 + flankArc + GT2_VALLEY_FLAT)),
      at(rOut, c + arc(land / 2 + 2 * flankArc + GT2_VALLEY_FLAT)),
    );
  }
  return points;
}

export interface PreludeOptions {
  /**
   * Segments for features the script does not size. 0 defers to the kernel's
   * adaptive settings, which an explicit count would override.
   */
  segments?: number;
  /** Keyed by solid instance, so any boolean or transform after color() drops the tag. */
  colorTags?: WeakMap<object, string>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const BALL_SEGMENTS: Record<FilletQuality, number> = { draft: 16, high: 32 };

let lastFilletMode: "exact" | "minkowski" | "smooth" | undefined;
let lastFilletQuality: FilletQuality | undefined;

/** Refuses unknown values: a silent downgrade to draft would be undetectable. */
function qualityOf(value: unknown): FilletQuality {
  if (value === undefined) return "draft";
  if (value === "draft" || value === "high") return value;
  throw new Error('fillet quality must be "draft" or "high"');
}

function axisIndex(axis: unknown): 0 | 1 | 2 {
  if (axis === "x") return 0;
  if (axis === "y") return 1;
  if (axis === "z" || axis === undefined) return 2;
  throw new Error("axis must be 'x', 'y' or 'z'");
}

/**
 * manifold-3d turns a scalar scale into {x: s, y: 0}, collapsing the top face,
 * so scalars are expanded to [s, s].
 */
function uniformScale(scale: unknown): [number, number] {
  if (typeof scale === "number") return [scale, scale];
  return Array.isArray(scale) ? [scale[0], scale[1]] : [1, 1];
}

/** Accepts one contour or many: a single contour's first element is a point. */
function normaliseContours(points: any[]): any[] {
  const first = points[0];
  return Array.isArray(first) && typeof first[0] === "number" ? [points] : points;
}

function assertContours(contours: any[]): void {
  for (const contour of contours) {
    if (!Array.isArray(contour) || contour.length < 3) {
      throw new Error("polygon needs at least 3 points per contour");
    }
  }
}

/**
 * Stacks solids end to end along one axis from a base at the origin, so
 * assemblies need no half-height arithmetic. Each solid sinks STACK_OVERLAP_MM
 * into the previous one, because exactly butted faces do not always fuse.
 */
function stackAlong(solids: any[], axis: 0 | 1 | 2): any {
  if (!Array.isArray(solids) || solids.length === 0) {
    throw new Error("stack needs a non-empty list of solids");
  }
  let cursor = 0;
  let out: any = null;
  for (const solid of solids) {
    if (typeof solid?.boundingBox !== "function") {
      throw new Error("stack needs solids, not " + typeof solid);
    }
    const box = solid.boundingBox();
    if (out) cursor -= STACK_OVERLAP_MM;
    const shift = [0, 0, 0];
    shift[axis] = cursor - box.min[axis];
    const placed = solid.translate(shift);
    out = out ? out.add(placed) : placed;
    cursor += box.max[axis] - box.min[axis];
  }
  return out;
}

/** Far below print tolerance, above float32 rounding at the sizes the gates allow. */
const STACK_OVERLAP_MM = 1e-3;

/** One post per [x, y] position from z = 0; shared by standoffs and boardCase. */
function standoffPosts(module: ManifoldModule, holes: any[], o: any, segments: number): any {
  const outer = o.diameter ?? 6;
  const height = o.height ?? 5;
  let out: any = null;
  for (const [x, y] of holes) {
    let post: any = module.Manifold.cylinder(height, outer / 2, outer / 2, segments, true)
      .translate([x, y, height / 2]);
    if (o.screw > 0) {
      post = post.subtract(
        module.Manifold.cylinder(height + 2, o.screw / 2, o.screw / 2, segments, true)
          .translate([x, y, height / 2]),
      );
    }
    out = out ? out.add(post) : post;
  }
  return out;
}

/**
 * Normalises a cutout edge to 'x-', 'x+', 'y-' or 'y+'. Axis and sign are read
 * independently, so '+x', 'x_max' and 'x+' all work.
 */
function edgeOf(value: unknown): string {
  const s = String(value ?? "").toLowerCase();
  const axis = s.includes("x") ? "x" : s.includes("y") ? "y" : "";
  if (axis === "") {
    throw new Error(
      "cutout edge must name an axis and a side, got '" + s + "'. Use 'x-' for the " +
      "edge at x = 0, 'x+' for the edge at x = boardLength, and 'y-' / 'y+' likewise " +
      "for the y edges. A word like 'left' does not say which board axis it means, " +
      "and guessing it would put a port through the wrong wall.",
    );
  }
  const negative = s.includes("-") || s.includes("min") || s.includes("neg");
  return axis + (negative ? "-" : "+");
}

/** Refused rather than clamped: a cutout off its wall would silently cut nothing. */
function assertOnWall(edge: string, at: number, run: number, L: number, W: number): void {
  if (at >= 0 && at <= run) return;
  throw new Error(
    "boardCase cutout on wall '" + edge + "' has at = " + at + ", but that wall is " +
    "only " + run + " mm long (0 to " + run + "). The x walls run along boardWidth (" +
    W + " mm) and the y walls along boardLength (" + L + " mm). Put the port on the " +
    "wall it is actually on, or measure 'at' along that wall.",
  );
}

/** A block that punches a through-opening in a case wall. */
function cutoutFor(
  module: ManifoldModule, c: any, L: number, W: number, gap: number, wall: number,
): any {
  const Manifold = module.Manifold;
  // Accepts both `wall`/`z` and the older `edge`/`sill` spellings.
  const s = { width: 12, height: 12, ...c };
  const depth = wall + gap + 4;
  const half = gap + wall;
  const edge = edgeOf(s.wall ?? s.edge);
  const alongX = edge.charAt(0) === "x";
  const span = alongX ? L : W;
  assertOnWall(edge, s.at, alongX ? W : L, L, W);
  const seat = edge.charAt(1) === "+" ? span + half - wall + depth : wall - half - depth;
  const across = [seat, s.at, (s.z ?? s.sill ?? 0) + s.height / 2];
  const centre = alongX ? across : [across[1], across[0], across[2]];
  const size = alongX ? [depth * 2, s.width, s.height] : [s.width, depth * 2, s.height];
  return Manifold.cube(size, true).translate(centre);
}

function alignToAxis(solid: any, axis: unknown): any {
  const a = axisIndex(axis);
  if (a === 0) return solid.rotate([0, 90, 0]);
  if (a === 1) return solid.rotate([-90, 0, 0]);
  return solid;
}

export function buildPrelude(
  module: ManifoldModule,
  options: PreludeOptions = {},
): PreludeHelpers {
  lastFilletMode = undefined;
  lastFilletQuality = undefined;
  const { Manifold, CrossSection } = module;
  const colorTags = options.colorTags ?? new WeakMap<object, string>();

  const segmentsFor = (featureOpts: any): number =>
    featureOpts?.segments ?? options.segments ?? DEFAULT_SEGMENTS;

  const cutHole = (part: any, opts: any): any => {
    const { diameter, axis, at, through = true } = opts ?? {};
    if (!(diameter > 0)) throw new Error("hole needs a positive diameter");
    const a = axisIndex(axis);
    const box = part.boundingBox();
    const span = box.max[a] - box.min[a];
    const depth = through ? span * 2 : (opts.depth ?? span);
    const cutter = alignToAxis(
      Manifold.cylinder(depth, diameter / 2, diameter / 2, segmentsFor(opts), true), axis,
    );
    const inPlane = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
    const centre: [number, number, number] = [0, 0, 0];
    centre[a] = through ? (box.min[a] + box.max[a]) / 2 : box.max[a] - depth / 2;
    if (Array.isArray(at)) {
      centre[inPlane[0]] = at[0];
      centre[inPlane[1]] = at[1];
    }
    return part.subtract(cutter.translate(centre));
  };

  /**
   * Rounds convex edges by opening (erode, then dilate) with a ball, so outer
   * dimensions are preserved; plain Minkowski dilation would grow every face.
   */
  const openByBall = (part: any, r: number, label: string, quality: FilletQuality): any => {
    const ball = Manifold.sphere(r, BALL_SEGMENTS[quality]);
    const eroded = part.minkowskiDifference(ball);
    // Dilating an empty manifold returns the ball, so refuse instead.
    if (eroded.isEmpty()) {
      throw new Error(label + ": radius " + r + " is too large for this part");
    }
    return eroded.minkowskiSum(ball);
  };

  /** A rounded-rect solid spanning z0 to z1. */
  const slab = (w: number, d: number, r: number, z0: number, z1: number): any =>
    Manifold.extrude(roundRect(w, d, Math.max(0, r)), z1 - z0, 0, 0, [1, 1], true)
      .translate([0, 0, (z0 + z1) / 2]);

  /**
   * One Gridfinity base segment: inset i0 at z0 lofted to inset i1 at z1. A
   * hull of two thin wafers, because a 45-degree chamfer must grow the corner
   * radius by the inset and extrude's scaleTop scales it instead.
   */
  const baseSegment = (
    w: number, d: number, i0: number, z0: number, i1: number, z1: number,
    r: number = GF_CORNER_RADIUS,
  ): any => {
    // The wafers sit inside z0..z1 so the hull spans it exactly.
    const eps = 0.01;
    return Manifold.hull([
      slab(w - 2 * i0, d - 2 * i0, r - i0, z0, z0 + eps),
      slab(w - 2 * i1, d - 2 * i1, r - i1, z1 - eps, z1),
    ]);
  };

  /** One baseplate cell cutter, overshooting both faces to avoid coplanar cuts. */
  const baseplatePocket = (): any => {
    const r = GF_PLATE_CORNER_RADIUS;
    const iB = GF_PLATE_TAPER_BOTTOM + GF_TAPER_TOP;
    const iM = GF_TAPER_TOP;
    const zRiser = GF_PLATE_TAPER_BOTTOM;
    const zTaper = GF_PLATE_TAPER_BOTTOM + GF_RISER;
    const over = 1;
    return baseSegment(GF_GRID, GF_GRID, iB, -over, iB, 0, r)
      .add(baseSegment(GF_GRID, GF_GRID, iB, 0, iM, zRiser, r))
      .add(baseSegment(GF_GRID, GF_GRID, iM, zRiser, iM, zTaper, r))
      .add(baseSegment(GF_GRID, GF_GRID, iM, zTaper, -over, GF_PLATE_HEIGHT + over, r));
  };

  const roundRect = (w: number, d: number, r: number): any => {
    const radius = Math.max(0, Math.min(r, Math.min(w, d) / 2));
    if (radius === 0) return CrossSection.square([w, d], true);
    return CrossSection.square([w - 2 * radius, d - 2 * radius], true)
      .offset(radius, "Round", 2, segmentsFor(undefined));
  };

  const helpers: Record<string, unknown> = {
    box: (w: number, d: number, h: number) => Manifold.cube([w, d, h], true),

    cylinder: (r: number, h: number, opts: any = {}) =>
      Manifold.cylinder(h, r, r, segmentsFor(opts), true),

    sphere: (r: number, opts: any = {}) => Manifold.sphere(r, segmentsFor(opts)),

    rect: (w: number, d: number) => CrossSection.square([w, d], true),

    /** One contour, or several for holes: even-odd fill makes enclosed contours holes. */
    polygon: (points: any, opts: any = {}) => {
      if (!Array.isArray(points)) throw new Error("polygon needs a list of [x, y] points");
      const contours = normaliseContours(points);
      assertContours(contours);
      return CrossSection.ofPolygons(contours, opts.fillRule ?? "EvenOdd");
    },

    circle: (r: number, opts: any = {}) => CrossSection.circle(r, segmentsFor(opts)),

    roundRect,

    extrude: (profile: any, h: number, opts: any = {}) =>
      Manifold.extrude(profile, h, opts.nDivisions ?? 0, opts.twistDegrees ?? 0,
        uniformScale(opts.scaleTop), true),

    revolve: (profile: any, opts: any = {}) =>
      Manifold.revolve(profile, segmentsFor(opts), opts.degrees ?? 360),

    /** The only exact fillet Manifold can offer: round the 2D profile, then extrude. */
    roundedBox: (w: number, d: number, h: number, r: number) => {
      lastFilletMode = "exact";
      return Manifold.extrude(roundRect(w, d, r), h, 0, 0, [1, 1], true);
    },

    hole: cutHole,

    boltCircle: (part: any, opts: any) => {
      const { count, diameter, circleDiameter, axis, at = [0, 0] } = opts ?? {};
      if (!(count > 0)) throw new Error("boltCircle needs a positive count");
      let out = part;
      for (let i = 0; i < count; i++) {
        const theta = (2 * Math.PI * i) / count;
        const r = circleDiameter / 2;
        out = cutHole(out, {
          diameter, axis, through: true,
          at: [at[0] + r * Math.cos(theta), at[1] + r * Math.sin(theta)],
        });
      }
      return out;
    },

    /**
     * An involute spur gear, centred, extruded along Z. Gears mesh with the same
     * module and pressure angle at gearDistance(). Checked against BOSL2
     * gears.scad (BSD-2-Clause, by Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    spurGear: (opts: any = {}) => {
      const o = opts ?? {};
      const helical = o.helical ?? 0;
      const { mt, phi } = transverseGear(o.module, o.pressureAngle, helical, "spurGear");
      const bore = o.bore ?? 0;
      const radii = gearRadii(mt, o.teeth, phi, o.module);
      assertGearSpec(o.module, o.teeth, o.thickness, bore, radii.root);
      const section = CrossSection.ofPolygons([spurOutlinePoints(mt, o.teeth, phi, o.steps ?? GEAR_FLANK_STEPS, o.module)]);
      const solid = helicalExtrude(Manifold, section, o.thickness, radii.pitch, helical, Boolean(o.herringbone));
      if (!(bore > 0)) return solid;
      return solid.subtract(
        Manifold.cylinder(o.thickness + 2, bore / 2, bore / 2, segmentsFor(undefined), true),
      );
    },

    /**
     * An internal ring gear, built as BOSL2's ring_gear(): a disc minus an
     * external gear with swapped tooth height and the opposite helix. A
     * planetary set needs z_ring = z_sun + 2 x z_planet.
     */
    ringGear: (opts: any = {}) => {
      const o = opts ?? {};
      const helical = o.helical ?? 0;
      const { mt, phi } = transverseGear(o.module, o.pressureAngle, helical, "ringGear");
      assertRingGearBasics(o);
      const radii = gearRadii(mt, o.teeth, phi, o.module, true);
      const outer = ringOuterRadius(o, radii);
      const cutter = CrossSection.ofPolygons([spurOutlinePoints(mt, o.teeth, phi, o.steps ?? GEAR_FLANK_STEPS, o.module, true)]);
      const section = CrossSection.circle(outer, segmentsFor(undefined)).subtract(cutter);
      return helicalExtrude(Manifold, section, o.thickness, radii.pitch, -helical, Boolean(o.herringbone));
    },

    /**
     * A GT2 timing pulley from published standard dimensions: flange, toothed
     * body, flange, lying on z = 0. Dimensions are facts and carry no credit.
     */
    gt2Pulley: (opts: any = {}) => {
      const s = resolveGt2Spec(opts);
      let part = Manifold.extrude(
        CrossSection.ofPolygons([gt2OutlinePoints(s.teeth)]),
        s.beltWidth, 0, 0, [1, 1], false,
      ).translate([0, 0, s.flangeThickness]);
      if (s.flanges) {
        const flange = Manifold.cylinder(s.flangeThickness, s.flangeDiameter / 2, s.flangeDiameter / 2, segmentsFor(opts), false);
        part = part.add(flange).add(flange.translate([0, 0, s.flangeThickness + s.beltWidth]));
      }
      part = part.subtract(
        Manifold.cylinder(s.total + 2, s.bore / 2, s.bore / 2, segmentsFor(opts), true)
          .translate([0, 0, s.total / 2]),
      );
      if (s.screwDiameter > 0) {
        part = part.subtract(
          Manifold.cylinder(2 * s.rRoot, s.screwDiameter / 2, s.screwDiameter / 2, segmentsFor(opts), true)
            .rotate([0, 90, 0]).translate([0, 0, s.flangeThickness + s.beltWidth / 2]),
        );
      }
      return part;
    },

    /** The Gridfinity foot for a unitsX x unitsY bin, sitting on z = 0. */
    gridfinityBase: (opts: any = {}) => {
      const o = opts ?? {};
      const ux = o.unitsX ?? 1;
      const uy = o.unitsY ?? ux;
      if (!(ux >= 1) || !(uy >= 1)) {
        throw new Error("gridfinityBase needs unitsX and unitsY of at least 1");
      }
      const w = ux * GF_GRID - 2 * GF_CLEARANCE;
      const d = uy * GF_GRID - 2 * GF_CLEARANCE;
      const iB = GF_TAPER_BOTTOM + GF_TAPER_TOP;
      const iM = GF_TAPER_TOP;
      const zRiser = GF_TAPER_BOTTOM;
      const zTaper = GF_TAPER_BOTTOM + GF_RISER;
      return baseSegment(w, d, iB, 0, iM, zRiser)
        .add(baseSegment(w, d, iM, zRiser, iM, zTaper))
        .add(baseSegment(w, d, iM, zTaper, 0, GF_BASE_HEIGHT));
    },

    /**
     * A Gridfinity baseplate (the grid bins drop into), centred, on z = 0. Not
     * gridfinityBase, which is the foot under a bin.
     */
    gridfinityBaseplate: (opts: any = {}) => {
      const [ux, uy] = baseplateUnits(opts);
      const pocket = baseplatePocket();
      const pockets = gridCentres(ux, uy).map(([x, y]) => pocket.translate([x, y, 0]));
      return slab(ux * GF_GRID, uy * GF_GRID, GF_PLATE_CORNER_RADIUS, 0, GF_PLATE_HEIGHT)
        .subtract(Manifold.union(pockets));
    },

    /** One post per [x, y] hole, rising from z = 0, with an optional screw bore. */
    standoffs: (holes: any, opts: any = {}) => {
      const o = opts ?? {};
      if (!Array.isArray(holes) || holes.length === 0) {
        throw new Error("standoffs needs a non-empty list of [x, y] positions");
      }
      return standoffPosts(module, holes, o, segmentsFor(undefined));
    },

    /**
     * A desk stand for a phone or tablet, profile points and all. Port of
     * DrLex's SmartPhoneHolder (CC-BY); credited in ATTRIBUTED_HELPERS.
     */
    phoneStand: (opts: any = {}) => {
      const o = opts ?? {};
      const thick = o.thickness ?? 12;
      const lift = o.lift ?? 40;
      const width = o.width ?? 60;
      const rearLip = o.rearLip ?? 15;
      const DEG10 = (10 * Math.PI) / 180;
      const ox = thick * Math.cos(DEG10);
      const ox2 = ox + (thick * Math.sin(DEG10) + lift - 38.2967) * Math.tan(DEG10);
      const lift2 = lift + thick * Math.sin(DEG10);
      const rear = rearLip + 14.495;
      const outer: number[][] = [
      [rear, 0],
      [rear, 2],
      [16.495, 2],
      [15.877, 2.09789],
      [15.3195, 2.38197],
      [14.877, 2.82443],
      [14.5929, 3.38197],
      [14.495, 4],
      [14.4182, 23.5716 + lift],
      [14.1905, 24.322 + lift],
      [13.8209, 25.0135 + lift],
      [13.3234, 25.6196 + lift],
      [12.7173, 26.1171 + lift],
      [12.0258, 26.4867 + lift],
      [11.2754, 26.7144 + lift],
      [10.495, 26.7912 + lift],
      [8.758, 26.7912 + lift],
      [7.96429, 26.7155 + lift],
      [7.17439, 26.4914 + lift],
      [6.41864, 26.1273 + lift],
      [5.72611, 25.6374 + lift],
      [5.12338, 25.0405 + lift],
      [4.63365, 24.3595 + lift],
      [4.27570, 23.6205 + lift],
      [4.06332, 22.852 + lift],
      [0.034995, 0.447456 + lift],
      [-0.234827, 0.165604 + lift],
      [-0.591969, 0.008461 + lift],
      [-0.982058, lift],
      [0.362259 - ox, -0.159795 + lift2],
      [0.080406 - ox, 0.110022 + lift2],
      [-0.076738 - ox, 0.467158 + lift2],
      [-0.085251 - ox, 0.857245 + lift2],
      [0.959858 - ox, 6.78435 + lift2],
      [-1.00976 - ox, 7.13165 + lift2],
      [-7.90847 - ox2, 5.81525],
      [-7.83752 - ox2, 4.7634],
      [-7.59339 - ox2, 3.764],
      [-7.1821 - ox2, 2.84167],
      [-6.61377 - ox2, 2.0191],
      [-5.90239 - ox2, 1.31657],
      [-5.06549 - ox2, 0.751364],
      [-4.12367 - ox2, 0.3374],
      [-3.10012 - ox2, 0.084871],
      [-2.02004 - ox2, 0],
      ];
      const inner: number[][] = [
      [12.495, 4],
      [12.3971, 3.38197],
      [12.1131, 2.82443],
      [11.6706, 2.38197],
      [11.1131, 2.09789],
      [10.495, 2],
      [-2.59531 - ox2, 2.09461],
      [-3.48387 - ox2, 2.37482],
      [-4.26807 - ox2, 2.82985],
      [-4.91777 - ox2, 3.44222],
      [-5.40802 - ox2, 4.18839],
      [-5.71996 - ox2, 5.03969],
      [-5.84161 - ox2, 5.96341],
      [-5.7683 - ox2, 6.92404],
      [-0.638426 - ox, -2.71833 + lift2],
      [-0.368612 - ox, -2.43648 + lift2],
      [-0.011475 - ox, -2.27934 + lift2],
      [0.378613 - ox, -2.27083 + lift2],
      [-0.658872, -2.01151 + lift],
      [0.0041122, -1.90311 + lift],
      [0.626352, -1.6499 + lift],
      [1.17665, -1.26458 + lift],
      [1.62741, -0.766468 + lift],
      [1.95602, -0.180542 + lift],
      [2.14601, 0.463818 + lift],
      [6.24633, 23.3314 + lift],
      [6.52989, 23.8064 + lift],
      [6.91965, 24.2143 + lift],
      [7.38906, 24.5273 + lift],
      [7.90612, 24.7241 + lift],
      [8.43559, 24.7912 + lift],
      [10.495, 24.7912 + lift],
      [11.0127, 24.7231 + lift],
      [11.495, 24.5233 + lift],
      [11.9092, 24.2054 + lift],
      [12.2271, 23.7912 + lift],
      [12.4269, 23.3089 + lift],
      [12.495, 22.7912 + lift],
      ];
      void rear;
      return Manifold.extrude(
        CrossSection.ofPolygons([outer, inner], "EvenOdd"), width, 0, 0, [1, 1], true,
      ).rotate([0, 0, 90]).translate([lift / 2 + 10, 0, 0]);
    },

    /**
     * A one-piece PCB case in the board's frame: lower-left corner at (0, 0),
     * standoffs on `holes`, ports cut through the wall by `cutouts`
     * ([{ wall: 'x-'|'x+'|'y-'|'y+', at, width, height, z }]). Shell layout
     * after raksahb's Pi 4 case (MIT); credited in ATTRIBUTED_HELPERS.
     */
    boardCase: (opts: any = {}) => {
      const o = { ...CASE_DEFAULTS, ...(opts ?? {}) };
      const L = o.boardLength;
      const W = o.boardWidth;
      const wall = o.wall;
      const floorT = o.floor;
      const gap = o.clearance;
      const stand = o.standoff;
      const cavity = o.height;
      const r = o.cornerRadius;
      const total = floorT + cavity;
      const outerL = L + 2 * (gap + wall);
      const outerW = W + 2 * (gap + wall);
      const cx = L / 2;
      const cy = W / 2;

      let part: any = Manifold.extrude(roundRect(outerL, outerW, r), total, 0, 0, [1, 1], true)
        .translate([cx, cy, total / 2])
        .subtract(Manifold.cube([L + 2 * gap, W + 2 * gap, cavity + 1], true)
          .translate([cx, cy, floorT + (cavity + 1) / 2]));

      if (o.holes.length > 0) {
        part = part.add(standoffPosts(module, o.holes, {
          diameter: o.standoffDiameter,
          height: stand,
          screw: o.screw,
        }, segmentsFor(undefined)).translate([0, 0, floorT]));
      }

      for (const c of o.cutouts) {
        part = part.subtract(cutoutFor(module, c, L, W, gap, wall));
      }
      return part;
    },

    /**
     * The lid for a boardCase from the same options: a plate with a friction-fit
     * lip, laid beside the case for printing.
     */
    boardCaseLid: (opts: any = {}) => {
      const o = {
        ...CASE_DEFAULTS, lidThickness: 2.5, lipHeight: 3, lipWall: 1.5, lipClearance: 0.2, spacing: 6,
        ...(opts ?? {}),
      };
      const L = o.boardLength;
      const W = o.boardWidth;
      const gap = o.clearance;
      const outerL = L + 2 * (gap + o.wall);
      const outerW = W + 2 * (gap + o.wall);
      const innerL = L + 2 * gap - 2 * o.lipClearance;
      const innerW = W + 2 * gap - 2 * o.lipClearance;
      if (!(o.lipWall > 0 && innerL - 2 * o.lipWall > 0 && innerW - 2 * o.lipWall > 0)) {
        throw new Error("boardCaseLid: lipWall " + o.lipWall + " leaves no opening inside the lip");
      }
      const plate = Manifold.extrude(roundRect(outerL, outerW, o.cornerRadius), o.lidThickness, 0, 0, [1, 1], true)
        .translate([0, 0, o.lidThickness / 2]);
    /** The lip starts inside the plate, so the two are one body. */
      const lip = Manifold.cube([innerL, innerW, o.lipHeight + 0.5], true)
        .subtract(Manifold.cube([innerL - 2 * o.lipWall, innerW - 2 * o.lipWall, o.lipHeight + 2], true))
        .translate([0, 0, o.lidThickness + (o.lipHeight + 0.5) / 2 - 0.5]);
      return plate.add(lip).translate([L / 2 + outerL + o.spacing, W / 2, 0]);
    },

    /**
     * A hook that clips over a rail: a 300-degree ring with the gap facing down,
     * so the load closes it, plus an overlapping stem.
     */
    railHook: (opts: any = {}) => {
      const o = { ...HOOK_DEFAULTS, ...(opts ?? {}) };
      const inner = o.railDiameter / 2 + o.clearance;
      const outer = inner + o.wall;
      const width = o.width;
      const drop = o.drop;
      const stem = o.stem;

      const ringSolid = Manifold.extrude(
        CrossSection.ofPolygons([hookRing(inner, outer, 300)], "EvenOdd"),
        width, 0, 0, [1, 1], true,
      );
      const stemSolid = Manifold.cube([stem, drop, width], true)
        .translate([-(inner + o.wall / 2), -(inner + drop / 2) + 2, 0]);
      return ringSolid.add(stemSolid).rotate([90, 0, 0]);
    },

    /**
     * One knuckle-hinge half. Port of BOSL2 knuckle_hinge() (BSD-2-Clause, by
     * Adrian Mariano and Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    knuckleHinge: (opts: any = {}) =>
      knuckleHinge(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * A two-leaf print-in-place hinge (two bodies). Port of BOSL2 hinges.scad
     * (BSD-2-Clause, by Adrian Mariano and Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    printInPlaceHinge: (opts: any = {}) =>
      printInPlaceHinge(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /** One spool holder part. Port by Matthew Burke (MIT); credited in ATTRIBUTED_HELPERS. */
    spoolHolder: (opts: any = {}) => spoolHolder(module, opts ?? {}),

    /** A complete Gridfinity bin. Port of basic_cup() by Jamie (vector76) (MIT); credited in ATTRIBUTED_HELPERS. */
    gridfinityCup: (opts: any = {}) => gridfinityCup(module, opts ?? {}),

    /** A screw-mounted J wall hook. Port by AaronVerDow (Unlicense); credited in ATTRIBUTED_HELPERS. */
    wallHook: (opts: any = {}) => wallHook(module, opts ?? {}),

    /**
     * A control knob, face down on z = 0; the caller subtracts the shaft bore.
     * Port by Maciej Małecki (MIT); credited in ATTRIBUTED_HELPERS.
     */
    knob: (opts: any = {}) => knob(module, opts ?? {}),

    /**
     * A rack meshing with spurGear of the same module. Port of BOSL2 rack()
     * (BSD-2-Clause, by Adrian Mariano and Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    rack: (opts: any = {}) => rack(module, opts ?? {}),

    /**
     * A bevel gear, pitch base on z = 0. A pair shares module and shaftAngle,
     * each takes the other's teeth as mateTeeth, and their apexes (bevelApex)
     * coincide. Port of BOSL2 bevel_gear() (BSD-2-Clause, by Adrian Mariano and
     * Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    bevelGear: (opts: any = {}) => bevelGear(module, opts ?? {}, bevelToothPoints),

    /** Height of a bevel gear's pitch-cone apex above its pitch base. */
    bevelApex: (opts: any = {}) => bevelApexHeight(opts ?? {}),

    /**
     * A worm, axis on Z, sized by pitch diameter; meshes with a matching
     * wormGear at wormDistance(). Port of BOSL2 worm() (BSD-2-Clause, by Adrian
     * Mariano and Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    worm: (opts: any = {}) => worm(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * A worm gear for one worm. Port of BOSL2 worm_gear() (BSD-2-Clause, by
     * Adrian Mariano and Revar Desmera); credited in ATTRIBUTED_HELPERS.
     */
    wormGear: (opts: any = {}) => wormGear(module, opts ?? {}, wormToothPoints),

    wormDistance: (opts: any = {}) => wormDistance(opts ?? {}),

    /** Centre distance of two meshing gears; teeth1 is the ring for internal: true. */
    gearDistance: (opts: any = {}) => gearDistanceBetween(opts ?? {}),

    /** A spool arm for 2020 extrusion, built from published dimensions. */
    extrusionSpoolArm: (opts: any = {}) => extrusionSpoolArm(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /** A split pipe clamp: two bolted half-rings, laid side by side (two bodies). */
    pipeClamp: (opts: any = {}) => pipeClamp(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /** A rack of deep cup pockets on a base. */
    cupRack: (opts: any = {}) => {
      const o = { ...RACK_DEFAULTS, ...(opts ?? {}) };
      const cup = o.cupDiameter;
      const gap = o.clearance;
      const cols = o.columns;
      const rows = o.rows;
      const depth = o.pocketDepth;
      const wall = o.wall;
      const pitch = cup + gap + wall;
      const plateX = cols * pitch + wall;
      const plateY = rows * pitch + wall;

      let part: any = Manifold.extrude(
        roundRect(plateX, plateY, 4), depth, 0, 0, [1, 1], true,
      ).translate([plateX / 2, plateY / 2, depth / 2]);

      const cutter = Manifold.cylinder(depth + 2, (cup + gap) / 2, (cup + gap) / 2, segmentsFor(undefined), true);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          part = part.subtract(cutter.translate([
            wall + pitch / 2 + i * pitch,
            wall + pitch / 2 + j * pitch,
            depth / 2,
          ]));
        }
      }
      return part;
    },

    stack: (solids: any[], opts: any = {}) => stackAlong(solids, axisIndex(opts.axis)),

    /**
     * Rounds existing edges without changing outer dimensions. "smooth" is
     * cosmetic and not dimension-preserving; the mode used is reported in stats.
     */
    filletEdges: (part: any, r: number, opts: any = {}) => {
      const mode = opts.mode ?? "auto";
      const quality = qualityOf(opts.quality);
      if (!(r > 0)) return part;
      if (mode === "smooth") {
        lastFilletMode = "smooth";
        return part.smoothOut(60, 1).refineToLength(r / 2);
      }
      lastFilletMode = "minkowski";
      lastFilletQuality = quality;
      return openByBall(part, r, "filletEdges", quality);
    },

    /** Same ball opening as filletEdges: Manifold has no exact chamfer. */
    chamferEdges: (part: any, r: number, opts: any = {}) => {
      const quality = qualityOf(opts.quality);
      if (!(r > 0)) return part;
      lastFilletMode = "minkowski";
      lastFilletQuality = quality;
      return openByBall(part, r, "chamferEdges", quality);
    },

    bbox: (part: any) => {
      const b = part.boundingBox();
      return {
        min: [...b.min],
        max: [...b.max],
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      };
    },

    volume: (part: any) => part.volume(),

    color: (part: any, hex: unknown) => {
      if (typeof hex !== "string" || !HEX_COLOR.test(hex)) throw new Error("color needs a #rrggbb hex");
      colorTags.set(part, hex.toLowerCase());
      return part;
    },
  };

  const result = helpers as PreludeHelpers;
  Object.defineProperty(result, "lastFilletMode", { get: () => lastFilletMode });
  Object.defineProperty(result, "lastFilletQuality", { get: () => lastFilletQuality });
  return result;
}
