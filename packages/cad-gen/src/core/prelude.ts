/**
 * The curated CAD prelude injected into every script.
 * @remarks This module defines the *published API* the model is prompted
 *   against. Adding, removing or renaming a helper is a breaking change to
 *   PRELUDE_VERSION (spec section 4).
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

/** Helper names injected into every script, in injection order. */
export const PRELUDE_NAMES = [
  "box", "cylinder", "sphere",
  "rect", "circle", "roundRect", "polygon", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "spurGear", "rack", "gridfinityBase", "gridfinityBaseplate", "standoffs", "boardCase", "phoneStand", "railHook",
  "cupRack", "knuckleHinge", "printInPlaceHinge", "spoolHolder", "gridfinityCup", "wallHook", "knob", "gt2Pulley", "extrusionSpoolArm", "pipeClamp", "boardCaseLid", "stack",
  "filletEdges", "chamferEdges",
  "bbox", "volume",
] as const;

export interface PreludeHelpers {
  /** Fillet strategy actually used, for stats reporting. */
  readonly lastFilletMode?: "exact" | "minkowski" | "smooth";
  /** Ball resolution actually used by the opening, for stats reporting. */
  readonly lastFilletQuality?: FilletQuality;
  [name: string]: unknown;
}

/**
 * How finely the rounding ball is tessellated.
 * @remarks The opening's cost is driven almost entirely by the ball's facet
 *   count, and it is not a small effect: measured on a stepped shaft, the
 *   dilation half of the opening takes 1.0s at 8 segments, 3.2s at 16 and
 *   15.6s at 32 - while the resulting volume moves by well under 1%. Draft is
 *   therefore the default, and "high" is an explicit request.
 */
export type FilletQuality = "draft" | "high";

/** Segments a circular feature gets when neither the script nor the host says. */
const DEFAULT_SEGMENTS = 64;

/**
 * Printability defaults for boardCase, every one overridable by the caller.
 * @remarks A defaults object rather than a chain of \`??\` at each use: the chain
 *   read fine and pushed the function's branching past the complexity gate, which
 *   is a fair signal that the defaults were doing work the caller's spec should
 *   do in one place.
 */
/** Defaults for railHook, every one overridable. */
const HOOK_DEFAULTS = {
  railDiameter: 25, wall: 5, width: 20, clearance: 0.4, drop: 40, stem: 9,
};

/** Defaults for cupRack, every one overridable. */
const RACK_DEFAULTS = {
  cupDiameter: 85, clearance: 3, columns: 2, rows: 2, pocketDepth: 22, wall: 3,
};

/**
 * The ring of a rail hook, as one closed contour: outer arc out, inner arc back.
 * @param inner Inner radius, mm. @param outer Outer radius, mm.
 * @param sweep Degrees wrapped, centred on the gap at the bottom.
 * @returns Points for a single closed polygon.
 */
function hookRing(inner: number, outer: number, sweep: number): number[][] {
  const steps = 60;
  const start = -60;
  /** @param i Step index. @param r Radius. @returns The point at that step. */
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

/**
 * Standard gear proportions, as multiples of the module.
 * @remarks ISO 53 / the usual 20-degree full-depth system. Changing either is
 *   changing the tooth form, not tuning it, so they are constants rather than
 *   options - two gears only mesh if both use the same ones.
 */
const GEAR_ADDENDUM = 1;
const GEAR_DEDENDUM = 1.25;
/**
 * Gridfinity, from gridfinity.xyz/specification via the reference CadQuery
 * generator. These are COMPATIBILITY constants: a bin whose base is a
 * hundredth of a millimetre out does not seat in anyone else's baseplate, so
 * they are not tunable and the numbers are quoted rather than derived.
 */
const GF_GRID = 42;
/** Per-side clearance, so a 1x1 footprint is 41.5 rather than 42. */
const GF_CLEARANCE = 0.25;
/** Base profile, bottom to top: 45-degree taper, riser, 45-degree taper. */
const GF_TAPER_BOTTOM = 0.8;
const GF_RISER = 1.8;
const GF_TAPER_TOP = 2.15;
const GF_BASE_HEIGHT = GF_TAPER_BOTTOM + GF_RISER + GF_TAPER_TOP;
const GF_CORNER_RADIUS = 3.75;
/**
 * The baseplate pocket: the bin's profile plus clearance, so the same riser and
 * top taper over a 0.7mm (not 0.8mm) bottom taper - 4.65mm tall - and a 4mm
 * corner radius at the 42mm cell boundary.
 */
const GF_PLATE_TAPER_BOTTOM = 0.7;
const GF_PLATE_HEIGHT = GF_PLATE_TAPER_BOTTOM + GF_RISER + GF_TAPER_TOP;
const GF_PLATE_CORNER_RADIUS = 4;
// The 7mm height unit, the 26mm magnet/screw square and the 6.5mm magnet holes
// are quoted in SYSTEM_PROMPT's STANDARDS section rather than kept here: no
// helper reads them, and a constant nothing reads is a constant that drifts.

/** Involute samples per flank. More is smoother and slower. */
const GEAR_FLANK_STEPS = 8;

/** Slices per full turn of a helical gear's twist - BOSL2 uses the pitch circle's segment count. */
const GEAR_HELIX_SEGMENTS = 64;

/** A baseplate's [unitsX, unitsY]: whole cells, at least one each way. */
function baseplateUnits(opts: any): [number, number] {
  const ux = opts?.unitsX ?? 1;
  const uy = opts?.unitsY ?? ux;
  if (!Number.isInteger(ux) || !Number.isInteger(uy) || ux < 1 || uy < 1) {
    throw new Error("gridfinityBaseplate needs whole unitsX and unitsY of at least 1");
  }
  return [ux, uy];
}

/** The [x, y] centre of every cell of a ux x uy grid centred on the origin. */
function gridCentres(ux: number, uy: number): [number, number][] {
  const out: [number, number][] = [];
  for (let ix = 0; ix < ux; ix++) {
    for (let iy = 0; iy < uy; iy++) {
      out.push([(ix - (ux - 1) / 2) * GF_GRID, (iy - (uy - 1) / 2) * GF_GRID]);
    }
  }
  return out;
}

/** The involute function, inv(a) = tan(a) - a. */
const involute = (a: number): number => Math.tan(a) - a;

interface GearRadii {
  /** d/2 where d = module x teeth. Two gears mesh on this circle. */
  pitch: number;
  /** The circle the involute is generated from. */
  base: number;
  /** Outer radius: the tips of the teeth. */
  tip: number;
  /** Root radius: the valleys between them. */
  root: number;
}

/**
 * The four radii every spur gear is defined by.
 * @param normalModule The module the tooth HEIGHT follows. For a helical gear
 *   the pitch circle uses the transverse module (module / cos(helix)) while the
 *   addendum and dedendum stay on the normal module, as in BOSL2; for a spur
 *   gear the two are the same.
 */
function gearRadii(m: number, z: number, phi: number, normalModule: number = m): GearRadii {
  const pitch = (m * z) / 2;
  return {
    pitch,
    base: pitch * Math.cos(phi),
    tip: pitch + GEAR_ADDENDUM * normalModule,
    root: pitch - GEAR_DEDENDUM * normalModule,
  };
}

/**
 * Half the angular width of one tooth at radius r.
 * @remarks The involute, and the whole reason a gear is not a polygon with
 *   pointy bits: the flank rolls on the base circle, so the tooth is widest at
 *   the base circle and narrows toward the tip by exactly inv(a) - inv(phi).
 *   That taper is what lets two gears of equal module and pressure angle turn
 *   together at a constant ratio. A trapezoid - the obvious guess - does not,
 *   and looks almost right on screen while being unusable.
 */
function halfToothAngle(r: number, radii: GearRadii, z: number, phi: number): number {
  const clamped = Math.max(r, radii.base);
  const alpha = Math.acos(Math.min(1, radii.base / clamped));
  return Math.PI / (2 * z) + involute(phi) - involute(alpha);
}

/**
 * One tooth's outline, counter-clockwise, from its leading root to its trailing one.
 * @remarks Below the base circle there is no involute, so the flank continues
 *   radially down to the root - the standard approximation, and why the root
 *   land is a plain arc.
 */
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
 * Extrudes a gear section along Z, centred, twisting it along a helix.
 * @remarks BOSL2's construction: the twist over the face width is
 *   360 x thickness x tan(helix) / pitch circumference; OpenSCAD twists
 *   clockwise for a positive angle, so Manifold (counter-clockwise) gets the
 *   negative, and the result is turned back half the twist so the mid-plane
 *   section is the untwisted profile. A herringbone is two opposite halves
 *   meeting at z = 0. A zero helix is a plain spur extrusion.
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

/**
 * Rejects a gear spec the kernel cannot build.
 * @remarks A bore at or beyond the root circle would leave nothing to hold the
 *   teeth, and the result would be a ring rather than the gear that was asked
 *   for - so it is refused by name rather than silently returned.
 */
function assertGearSpec(m: number, z: number, thickness: number, bore: number, root: number): void {
  if (!(m > 0)) throw new Error("spurGear needs a positive module");
  if (!(z >= 3)) throw new Error("spurGear needs at least 3 teeth");
  if (!(thickness > 0)) throw new Error("spurGear needs a positive thickness");
  if (bore > 0 && bore / 2 >= root) {
    throw new Error("spurGear: a " + bore + " bore does not fit inside the root diameter of " +
      (2 * root).toFixed(2));
  }
}

/** The closed 2D outline of a spur gear, as [x, y] millimetre points. */
function spurOutlinePoints(m: number, z: number, phi: number, steps: number, normalModule: number = m): number[][] {
  const radii = gearRadii(m, z, phi, normalModule);
  const points: number[][] = [];
  for (let i = 0; i < z; i++) {
    for (const p of toothPoints(i, z, phi, radii, steps)) points.push(p);
  }
  return points;
}

// Gates PowerGrip GT (GT2) 2mm-pitch dimensions. These are published
// standard dimensions - facts, not creative work - quoted from the Gates
// Light Power & Precision drive manual lineage (see backend/catalog.ts's
// provenance note) and cross-checked against a Gates-licensee catalog (CMT
// 2MR: pitch diameter minus outside diameter is 0.020" at every tooth count).
/** Belt pitch: 2mm. */
const GT2_PITCH = 2;
/**
 * Radial pitch factor: outside diameter = pitch diameter - 2 x 0.254.
 * @remarks A 20-tooth pulley is 12.73mm pitch, 12.22mm across the teeth -
 *   the "12.2mm GT2 pulley" every printer part is measured against.
 */
const GT2_PITCH_FACTOR = 0.254;
/** Nominal groove depth (the belt tooth height), per the SDP/SI handbook. */
const GT2_GROOVE_DEPTH = 0.76;
/** Flat at the groove bottom, between the two flanks. */
const GT2_VALLEY_FLAT = 0.45;
/** Half the included groove angle: the flanks lean 20 deg off the radial. */
const GT2_HALF_ANGLE = (20 * Math.PI) / 180;

/**
 * The radial clearance-hole diameter for a set-screw size, 0 for "none".
 * @remarks Refuses a size the helper does not know, naming the allowed set.
 */
function gt2ScrewDiameter(screw: unknown): number {
  const dia = ({ none: 0, M3: 3.4, M4: 4.5 } as Record<string, number>)[screw as string] ?? 0;
  if (dia === 0 && screw !== "none") {
    throw new Error('gt2Pulley: setScrew is "none", "M3" or "M4"');
  }
  return dia;
}

/**
 * Rejects a pulley spec the kernel cannot build.
 * @remarks A bore at or beyond the root circle minus 1mm would leave nothing
 *   to hold the teeth, and flanges that touch the bore are not flanges - both
 *   are refused by name rather than silently returned.
 */
function assertGt2Spec(z: number, width: number, bore: number, rRoot: number, flangeD: number): void {
  if (!(z >= 8)) throw new Error("gt2Pulley needs at least 8 teeth");
  if (!(width > 0)) throw new Error("gt2Pulley needs a positive beltWidth");
  if (!(bore > 0) || bore / 2 >= rRoot - 1) {
    throw new Error("gt2Pulley: a " + bore + " mm bore leaves no hub inside the " +
      (2 * rRoot).toFixed(2) + " mm root diameter");
  }
  if (flangeD <= bore) throw new Error("gt2Pulley: flangeDiameter must clear the bore");
}

/**
 * One resolved, validated GT2 pulley spec.
 * @remarks Every dimension the build reads, so the helper body assembles
 *   without re-deriving anything.
 */
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

/** Defaults, the standard radii and the set-screw size for one option set. */
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
 * The closed 2D outline of a GT2 pulley, as [x, y] millimetre points.
 * @remarks The Gates groove is a modified curvilinear profile; this is the
 *   straight-flanked approximation every printable pulley uses - tip flat,
 *   40 deg flanks, valley flat - with the dimensions above. Per tooth the
 *   outline emits six points: tip centre, land edge, valley edge, valley
 *   centre, and their mirrors, so consecutive points never span a groove.
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
   * Circular segments for every feature the script does not size itself.
   * @remarks 0 hands the decision to the kernel's adaptive default, which is
   *   derived from a maximum angle and a minimum edge length. The old
   *   hard-coded 64 stays the default because it is the delivery quality, but
   *   it is 4x what the kernel picks for a 2.5mm hole, and - because an
   *   explicit count OVERRIDES the adaptive settings - passing it made every
   *   host-side fidelity control inert. A host trading fidelity for speed
   *   passes 0 here and sets the adaptive controls on the module.
   */
  segments?: number;
}

/** Ball tessellation per quality level. */
const BALL_SEGMENTS: Record<FilletQuality, number> = { draft: 16, high: 32 };

let lastFilletMode: "exact" | "minkowski" | "smooth" | undefined;
let lastFilletQuality: FilletQuality | undefined;

/**
 * Resolves a requested fillet quality.
 * @remarks An unrecognised value is refused rather than quietly downgraded to
 *   the default: a caller that asked for high quality and silently got draft
 *   would have no way to tell, which is the failure this whole reporting
 *   convention exists to prevent.
 */
function qualityOf(value: unknown): FilletQuality {
  if (value === undefined) return "draft";
  if (value === "draft" || value === "high") return value;
  throw new Error('fillet quality must be "draft" or "high"');
}

/** Normalises an axis name to its index (x=0, y=1, z=2). */
function axisIndex(axis: unknown): 0 | 1 | 2 {
  if (axis === "x") return 0;
  if (axis === "y") return 1;
  if (axis === "z" || axis === undefined) return 2;
  throw new Error("axis must be 'x', 'y' or 'z'");
}

/**
 * Normalises a scale argument into the 2D vector the kernel actually reads.
 * @remarks The kernel wraps a scalar in an array before converting it
 *   (`vararg2vec2([scaleTop])`), and a one-element array becomes `{x: s, y: 0}`
 *   — so a bare number silently collapses the extrusion's top face and halves
 *   the volume. Verified against manifold-3d 3.5.3: an identity scalar `1`
 *   returns 50% of the profile's volume where `[1, 1]` returns 100%.
 */
function uniformScale(scale: unknown): [number, number] {
  if (typeof scale === "number") return [scale, scale];
  return Array.isArray(scale) ? [scale[0], scale[1]] : [1, 1];
}

/**
 * Accepts one contour or many, and returns the many-form the kernel wants.
 * @remarks A contour is a list of [x, y] pairs; a set of contours is a list of
 *   those. So the test is whether the first element is itself a point.
 */
function normaliseContours(points: any[]): any[] {
  const first = points[0];
  return Array.isArray(first) && typeof first[0] === "number" ? [points] : points;
}

/**
 * Rejects a contour the kernel cannot triangulate.
 * @remarks The count is per CONTOUR, not of the outer list: two contours of four
 *   points is six elements but only two of them are contours, so checking the
 *   outer length rejects a perfectly good profile with a bore.
 * @throws Error when any contour has fewer than three points.
 */
function assertContours(contours: any[]): void {
  for (const contour of contours) {
    if (!Array.isArray(contour) || contour.length < 3) {
      throw new Error("polygon needs at least 3 points per contour");
    }
  }
}

/**
 * Lays solids end to end along one axis, from a base at the origin, and unions them.
 * @remarks Every builder in this prelude is CENTRED, so assembling parts by hand
 *   means adding up half-heights - and that arithmetic is where assemblies go
 *   wrong. A live timing pulley stacked a flange at z = +width against a body
 *   spanning -7.5..7.5, which put it 6.5mm clear of the part with the bore never
 *   reaching it: a detached disc, and it took three attempts to notice. This
 *   removes the arithmetic instead of correcting it. Solids are stacked in the
 *   order given, so [flange, body, flange] is a body with a flange at each end.
 *   Each solid after the first sinks STACK_OVERLAP_MM into the one below it:
 *   faces butted exactly only fuse when the heights are exact binary fractions.
 * @throws Error when the list is empty or holds something that is not a solid.
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

/**
 * How far each stacked solid sinks into the one below it.
 * @remarks CADPrompt 00039012 stacked a 0.78575 mm flange under a pipe; butted
 *   exactly, rounding left the shared faces a hair apart and the part came back
 *   as two bodies on every repair round. A micron is far below print tolerance
 *   and well above float32 rounding at the 150 mm parts the gates allow.
 */
const STACK_OVERLAP_MM = 1e-3;

/**
 * One post per [x, y] position, rising from a base at z = 0.
 * @remarks Shared by `standoffs` and `boardCase`: a case that mounted its board
 *   with different arithmetic from a standalone standoff would be two chances to
 *   get the same placement wrong.
 * @param module The loaded Manifold module.
 * @param holes Board-relative [x, y] mounting-hole positions.
 * @param o diameter, height, and an optional screw bore.
 * @param segments Circular segments for the posts.
 * @returns The posts unioned, or null when there are none.
 */
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
 * Normalises a cutout edge to 'x-', 'x+', 'y-' or 'y+'.
 * @remarks The axis and the sign are read INDEPENDENTLY, so '+x', 'x_max' and
 *   'x+' all mean the same edge. Two live runs were lost to a strict spelling
 *   check: the model reached for boardCase correctly, described the cutout
 *   sensibly, and was refused on syntax. Refusing a spelling a caller finds
 *   natural costs a whole attempt and teaches it nothing about the geometry.
 * @param value Whatever the caller passed.
 * @returns The normalised edge.
 * @throws Error naming the value received, so a repair turn can fix it.
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

/**
 * Refuses a cutout whose centre is off its wall.
 * @remarks Refused, not clamped: attempt#1 put a Pi's HDMI at 75 on its 56 mm
 *   x+ wall, and the block cut thin air - a valid case with the port silently
 *   missing. An x wall RUNS along y, so its length is W, and a y wall's is L.
 * @throws Error naming the wall's real length, so a repair turn can move it.
 */
function assertOnWall(edge: string, at: number, run: number, L: number, W: number): void {
  if (at >= 0 && at <= run) return;
  throw new Error(
    "boardCase cutout on wall '" + edge + "' has at = " + at + ", but that wall is " +
    "only " + run + " mm long (0 to " + run + "). The x walls run along boardWidth (" +
    W + " mm) and the y walls along boardLength (" + L + " mm). Put the port on the " +
    "wall it is actually on, or measure 'at' along that wall.",
  );
}

/**
 * A block that punches one opening through a case wall.
 * @remarks Deliberately overshoots the wall on both sides, so the opening is a
 *   through-hole rather than a pocket - a connector needs clearance outside the
 *   case as much as inside it.
 * @param module The loaded Manifold module, for its cube.
 * @param c One cutout spec: edge, at, width, height, sill.
 * @param L Board length, mm. @param W Board width, mm.
 * @param gap Board-to-wall clearance. @param wall Wall thickness.
 * @returns A solid to subtract.
 */
function cutoutFor(
  module: ManifoldModule, c: any, L: number, W: number, gap: number, wall: number,
): any {
  const Manifold = module.Manifold;
  // Both spellings, because the model's is the better one: it writes
  // `{ wall: 'y+', at: 66, z: 6 }` where this API originally demanded
  // `{ edge: 'y+', sill: 6 }`. `wall` and `z` say what they are; `edge` and
  // `sill` are jargon. Refusing the clearer vocabulary to keep a synonym count
  // at zero costs a whole attempt and teaches the caller nothing.
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

/** Rotates a Z-aligned solid onto the requested axis. */
function alignToAxis(solid: any, axis: unknown): any {
  const a = axisIndex(axis);
  if (a === 0) return solid.rotate([0, 90, 0]);
  if (a === 1) return solid.rotate([-90, 0, 0]);
  return solid;
}

/**
 * Builds the helper set bound to a loaded Manifold module.
 * @param module A loaded manifold-3d toplevel (Manifold + CrossSection).
 */
export function buildPrelude(
  module: ManifoldModule,
  options: PreludeOptions = {},
): PreludeHelpers {
  lastFilletMode = undefined;
  lastFilletQuality = undefined;
  const { Manifold, CrossSection } = module;

  /** One feature's segment count: the script's choice, else the host's. */
  const segmentsFor = (featureOpts: any): number =>
    featureOpts?.segments ?? options.segments ?? DEFAULT_SEGMENTS;

  /** Cuts one axis-aligned hole; the two in-plane coordinates come from opts.at. */
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
   * Rounds the part's convex edges by opening it with a ball of radius r.
   * @remarks An opening is erode-then-dilate by the *same* ball. Plain
   *   Minkowski dilation is not a fillet, it is a rounded offset: it grows
   *   every face by r, so a 20 mm box came back 23 mm across and no longer fit
   *   its mating geometry. Eroding first keeps the result inside the original
   *   bounds, so the outer dimensions survive and only the edges change - the
   *   3D counterpart of the square(w - 2r, d - 2r) + offset(r) pattern
   *   `roundRect` already uses. A part thinner than 2r erodes to nothing and
   *   stays empty; that is reported as an empty solid, never silently replaced
   *   by a dilation.
   */
  const openByBall = (part: any, r: number, label: string, quality: FilletQuality): any => {
    const ball = Manifold.sphere(r, BALL_SEGMENTS[quality]);
    const eroded = part.minkowskiDifference(ball);
    // Dilating an *empty* manifold returns the other operand rather than
    // nothing, so without this check an over-large radius would hand the model
    // a bare ball of radius r instead of the part it started from. Refuse the
    // request instead: the caller must hear that r does not fit, and the
    // repair loop turns the throw into a fixable script error.
    if (eroded.isEmpty()) {
      throw new Error(label + ": radius " + r + " is too large for this part");
    }
    return eroded.minkowskiSum(ball);
  };

  /**
   * A rounded-rect solid spanning z0 to z1.
   * @remarks Builders here are centred, so a slab is placed by giving both ends
   *   rather than a centre and a height - which is the arithmetic that kept
   *   putting flanges in mid-air.
   */
  const slab = (w: number, d: number, r: number, z0: number, z1: number): any =>
    Manifold.extrude(roundRect(w, d, Math.max(0, r)), z1 - z0, 0, 0, [1, 1], true)
      .translate([0, 0, (z0 + z1) / 2]);

  /**
   * One Gridfinity base segment: the footprint inset `i0` at z0 lofted to inset
   * `i1` at z1.
   * @remarks A 45-degree chamfer is an OFFSET, so the corner radius has to grow
   *   by the same amount the walls move. extrude's scaleTop cannot do that - it
   *   scales the radius proportionally - so this lofts with the convex hull of
   *   two thin rounded rectangles, which is exact because a rounded rectangle is
   *   convex. Passing i0 == i1 gives the straight riser. `r` is the corner
   *   radius at inset 0: the bin's 3.75mm by default, 4mm for a baseplate pocket.
   */
  const baseSegment = (
    w: number, d: number, i0: number, z0: number, i1: number, z1: number,
    r: number = GF_CORNER_RADIUS,
  ): any => {
    // The wafers sit INSIDE the segment: the lower one grows upward from z0 and
    // the upper one ends at z1, so the hull spans exactly z0..z1. Centring them
    // on z0 and z1 would put 0.005mm of slop on the ends, and Gridfinity has no
    // room for slop.
    const eps = 0.01;
    return Manifold.hull([
      slab(w - 2 * i0, d - 2 * i0, r - i0, z0, z0 + eps),
      slab(w - 2 * i1, d - 2 * i1, r - i1, z1 - eps, z1),
    ]);
  };

  /**
   * The cutter for one baseplate cell, centred on the origin.
   * @remarks It overshoots both faces so no cut face is coplanar with the
   *   plate's: straight down through the floor, and the top taper carried on at
   *   45 degrees past the rim, so the rim is cut to the exact knife edge.
   */
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

    /**
     * Builds a 2D profile from a point list, ready for extrude or revolve.
     * @remarks The primitive for any part whose cross-section is a CUSTOM
     *   OUTLINE: gear and sprocket teeth, a cam, a pulley, a bracket that is not
     *   a rectangle. There is no way to assemble those from boxes around a
     *   cylinder without getting the placement arithmetic wrong, and a tooth
     *   that floats a fraction of a millimetre off the body still produces a
     *   watertight solid that passes every gate - measured on a live timing
     *   pulley, whose teeth sat 0.75mm clear of the body and reached above it.
     *   Pass one contour, or several when the profile has holes: the default
     *   even-odd fill rule makes a contour enclosed by another a hole, which is
     *   how a bore is drawn.
     */
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

    /**
     * Exact prismatic fillet: round the 2D profile, then extrude.
     * @remarks This is the only *exact* fillet strategy Manifold can offer (it
     *   is a mesh kernel, not a B-rep kernel) - prefer it for plates, brackets
     *   and enclosures.
     */
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
     * A spur gear, centred on the origin and extruded along Z.
     * @remarks Realises the involute profile so the model never writes the tooth
     *   trigonometry itself. The failure this replaces was a gear whose teeth
     *   were trapezoids: it looked plausible and meshed with nothing.
     *   To mesh, two gears need the SAME module and pressure angle, axes
     *   parallel, at centre distance (module x (z1 + z2)) / 2. helical (degrees)
     *   and herringbone follow BOSL2's helical construction - see helicalExtrude;
     *   cad-reference gear-helical / gear-herringbone verify it.
     *   LICENCE: the profile's proportions and construction were checked against
     *   BOSL2 gears.scad, which is BSD-2-Clause, by Revar Desmera and other
     *   contributors. The credit is declared in ATTRIBUTED_HELPERS
     *   (./attribution.ts) and returned with every design that calls this -
     *   BSD-2 would be satisfied by a notice in our source, but a notice is not
     *   a credit the person holding the printed part can see.
     */
    spurGear: (opts: any = {}) => {
      const o = opts ?? {};
      const helical = o.helical ?? 0;
      if (!(Math.abs(helical) < 90)) throw new Error("spurGear needs a helical angle between -90 and 90 degrees");
      const beta = (helical * Math.PI) / 180;
      // A helical gear is cut on its transverse section: module and pressure
      // angle grow by 1/cos(helix) there, the tooth height does not (BOSL2).
      const mt = o.module / Math.cos(beta);
      const phi = Math.atan(Math.tan(((o.pressureAngle ?? 20) * Math.PI) / 180) / Math.cos(beta));
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
     * A GT2 (Gates PowerGrip GT, 2mm pitch) timing pulley with belt flanges,
     * a shaft bore and an optional radial set-screw hole.
     * @remarks Built from the published standard dimensions (see the constants
     *   above): a 20-tooth pulley is 12.73mm pitch diameter, 12.22mm across
     *   the teeth, grooves 0.76mm deep - the part every printer uses but no
     *   model draws correctly by hand. The groove is the straight-flanked
     *   printable approximation (40 deg included), not the curvilinear
     *   molded profile. Lies on z = 0, axis on the origin: flange, toothed
     *   body of beltWidth, flange. Dimensions are facts and carry no credit
     *   (as Gridfinity's do).
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

    /**
     * The standard Gridfinity base for a unitsX x unitsY bin, sitting on z = 0.
     * @remarks The compatibility-critical half of a Gridfinity part: 42mm cells,
     *   a 41.5mm footprint per cell, and the 4.75mm three-segment base profile.
     *   Build the bin's floor and walls on top of this - the walls are plain
     *   boxes - and add the stacking lip if the bin must carry another on top.
     */
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
     * A Gridfinity BASEPLATE: the open grid frame bins drop into, unitsX x
     * unitsY cells, centred on the origin, sitting on z = 0.
     * @remarks NOT gridfinityBase - that is the FOOT under a bin, a solid that
     *   sits IN one of these pockets. The pocket is the bin profile inverted
     *   (0.7mm taper, 1.8mm riser, 2.15mm taper, 4.65mm tall, R4 at the 42mm
     *   cell edge) and open at the bottom, so the walls between cells rise to a
     *   knife edge exactly as the published "lite" baseplate does. The failure
     *   this replaces: asked for a baseplate, the model drew raised bumps on a
     *   slab - the inverse of a baseplate, which no bin can sit in.
     */
    gridfinityBaseplate: (opts: any = {}) => {
      const [ux, uy] = baseplateUnits(opts);
      const pocket = baseplatePocket();
      const pockets = gridCentres(ux, uy).map(([x, y]) => pocket.translate([x, y, 0]));
      return slab(ux * GF_GRID, uy * GF_GRID, GF_PLATE_CORNER_RADIUS, 0, GF_PLATE_HEIGHT)
        .subtract(Manifold.union(pockets));
    },

    /**
     * One post per [x, y] hole position, rising from a base at z = 0.
     * @remarks Mounting a board is where placement accuracy actually matters: a
     *   case whose posts are half a millimetre out does not fit the thing it was
     *   measured for. Passing the hole pattern straight from the board's
     *   published dimensions removes the per-post arithmetic, which is the step
     *   that goes wrong. Opts: outer diameter, height, and an optional screw
     *   diameter bored down from the top.
     */
    standoffs: (holes: any, opts: any = {}) => {
      const o = opts ?? {};
      if (!Array.isArray(holes) || holes.length === 0) {
        throw new Error("standoffs needs a non-empty list of [x, y] positions");
      }
      return standoffPosts(module, holes, o, segmentsFor(undefined));
    },


    /**
     * A desk stand that holds a phone or tablet at a lean.
     * @remarks PORTED, not generated. Direct translation of DrLex0's
     *   SmartPhoneHolder (CC-BY), profile points and all: every previous attempt
     *   to have the model draw this shape produced something that was one solid
     *   and still not a stand - a V-wedge, a flat panel with a fin. The profile
     *   is 91 hand-tuned points; there is nothing to infer and nothing to get
     *   wrong, so it is quoted.
     *   LICENCE: ported from DrLex0's SmartPhoneHolder, which is CC-BY. The
     *   credit is declared in ATTRIBUTED_HELPERS (./attribution.ts) and returned
     *   with every design that calls this, for the UI to show. Do not remove that
     *   entry: without it this helper produces a derivative work with no credit.
     *   The unit is one solid - a channel cut through a body - and nothing is
     *   assembled, which is why it cannot come apart.
     * @param opts thickness (phone gap, mm), lift (how high the phone sits),
     *   width (how much of the phone it holds).
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
     * A one-piece case body for a PCB, with standoffs on its mounting holes.
     * @remarks Owns ONE frame so there is no frame to mix up: the board's
     *   lower-left corner is (0, 0), it rises along +z, and the case is built
     *   around it. That matters because the failure here was never size - it was
     *   standoffs placed in board coordinates while the shell was built centred
     *   on the origin, which put two of four posts outside the walls and passed
     *   every gate. Taking the hole list straight from the board's published
     *   dimensions removes the arithmetic rather than correcting it.
     *
     *   Ports are cut THROUGH the wall with `cutouts`, each given as the edge to
     *   cut, where along that edge, and how big - a wall closed across a
     *   connector makes the case useless, and a plug needs clearance outside the
     *   wall as well as inside.
     *
     *   LICENCE: the shell structure - an open tray, ports grouped on one edge,
     *   standoffs on the floor - was worked out against raksahb's OpenSCAD Pi 4
     *   case, which is MIT. The credit is declared in ATTRIBUTED_HELPERS
     *   (./attribution.ts) and returned with every design that calls this.
     * @param opts boardLength and boardWidth (the PCB); holes as [[x, y], ...]
     *   board-relative; wall, floor, clearance, height (interior above the
     *   floor), standoff and screw; cutouts as
     *   [{ wall: 'x-'|'x+'|'y-'|'y+', at, width, height, z }] - `edge` and
     *   `sill` are accepted as aliases - where `at` is the position along that
     *   wall and `z` is how far its sill sits above the case floor.
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

      // Shell, in the board's frame, sitting on z = 0.
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
     * The lid for a boardCase, built from the SAME options, laid beside it for printing.
     * @remarks First-party. A live Uno case drew its lid with box() - centred on
     *   the origin - and placed it over boardCase, whose frame is the board's
     *   lower-left corner: the lid landed half off the case and fused into its
     *   rim. Built here, the lid shares boardCase's dimensions by construction.
     *   A rounded plate the case's outer size, with a hollow locating lip that
     *   drops inside the walls (lipClearance a side) for a friction fit, printed
     *   lip-up at x = outerLength + spacing in the board's frame. So
     *   boardCase(o).add(boardCaseLid(o)) is exactly two bodies, case and lid.
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
      // The lip starts INSIDE the plate, so plate and lip are one body.
      const lip = Manifold.cube([innerL, innerW, o.lipHeight + 0.5], true)
        .subtract(Manifold.cube([innerL - 2 * o.lipWall, innerW - 2 * o.lipWall, o.lipHeight + 2], true))
        .translate([0, 0, o.lidThickness + (o.lipHeight + 0.5) / 2 - 0.5]);
      return plate.add(lip).translate([L / 2 + outerL + o.spacing, W / 2, 0]);
    },

    /**
     * A hook that clips over a rail and cannot come off.
     * @remarks ONE extruded profile plus a stem that overlaps it, so the part is
     *   a single body and there is no join to get wrong. A live attempt drew this
     *   hook as an assembly and it came out as SIX disconnected pieces.
     *   The ring wraps 300 degrees, leaving a gap at the bottom narrower than the
     *   rail: it slides on from the end of the rail and cannot be pulled off, and
     *   because the gap faces down the load pulls the ring CLOSED rather than
     *   open. A ring that wraps less than 180 degrees is an open C and drops its
     *   load the moment it swings.
     * @param opts railDiameter, wall, width (extrusion), drop (stem length),
     *   stem (stem thickness), clearance.
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
      // The stem hangs off the back of the ring and OVERLAPS it, so the union is
      // one body - not two shapes that happen to touch.
      const stemSolid = Manifold.cube([stem, drop, width], true)
        .translate([-(inner + o.wall / 2), -(inner + drop / 2) + 2, 0]);
      return ringSolid.add(stemSolid).rotate([90, 0, 0]);
    },

    /**
     * One half of a knuckle hinge, to mount on the user's own part.
     * @remarks PORT of knuckle_hinge() from BOSL2 hinges.scad, BSD-2-Clause, by
     *   Adrian Mariano and Revar Desmera (github.com/adrianVmariano,
     *   github.com/revarbat) - credited through ATTRIBUTED_HELPERS. Mounting face
     *   on z = 0, pin axis along X at y = clearance, z = offset; the arm reaches
     *   toward -y. Matches OpenSCAD's render: scripts/cad-reference.mjs.
     */
    knuckleHinge: (opts: any = {}) =>
      knuckleHinge(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * A complete two-leaf print-in-place hinge, captured on cone-tipped pins.
     * @remarks PORT of the print-in-place example in BOSL2 hinges.scad,
     *   BSD-2-Clause, by Adrian Mariano and Revar Desmera
     *   (github.com/adrianVmariano, github.com/revarbat) - credited through
     *   ATTRIBUTED_HELPERS. TWO bodies by design: fused leaves are not a hinge.
     */
    printInPlaceHinge: (opts: any = {}) =>
      printInPlaceHinge(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * One print part of a multipart filament spool holder.
     * @remarks PORT of filament_spool_holder.scad from
     *   3dthings-filament-spool-holder, MIT, by Matthew Burke
     *   (github.com/Burke9077) - credited through ATTRIBUTED_HELPERS. Matches
     *   OpenSCAD's render of every part: scripts/cad-reference.mjs.
     */
    spoolHolder: (opts: any = {}) => spoolHolder(module, opts ?? {}),

    /**
     * A complete Gridfinity bin: feet, walls, stacking lip, chambers, label tab.
     * @remarks PORT of basic_cup() from gridfinity_openscad, MIT, by Jamie (vector76)
     *   (github.com/vector76) - credited through ATTRIBUTED_HELPERS. Matches
     *   OpenSCAD's render: scripts/cad-reference.mjs, cases gf-cup-*.
     */
    gridfinityCup: (opts: any = {}) => gridfinityCup(module, opts ?? {}),

    /**
     * A screw-mounted J-shaped wall hook with two countersunk holes.
     * @remarks PORT of wall_hook() from parametrized_wall_hook.scad, Unlicense
     *   (public domain), by AaronVerDow (github.com/AaronVerDow) - credited
     *   through ATTRIBUTED_HELPERS anyway. Matches OpenSCAD's render:
     *   scripts/cad-reference.mjs, cases wall-hook-*.
     */
    wallHook: (opts: any = {}) => wallHook(module, opts ?? {}),

    /**
     * A star- or round-profile control knob with an optional spacer stem.
     * @remarks PORT of knob() from mmalecki/openscad-knobs, MIT, by
     *   Maciej Małecki (github.com/mmalecki) - credited through
     *   ATTRIBUTED_HELPERS. Face down on z = 0, axis on the origin. Returns
     *   the UNCUTOFF solid: subtract the shaft bore from the returned solid.
     *   Matches OpenSCAD's render: scripts/cad-reference.mjs, cases knob-*.
     */
    knob: (opts: any = {}) => knob(module, opts ?? {}),

    /**
     * A straight gear rack that meshes with spurGear of the same module.
     * @remarks PORT of rack() from BelfrySCAD/BOSL2 gears.scad, BSD-2-Clause,
     *   by Adrian Mariano and Revar Desmera; credited in
     *   ATTRIBUTED_HELPERS. Teeth along X, tips toward +Z, face width along
     *   Y, base at z = -bottom. Matches OpenSCAD's render of BOSL2's own
     *   rack(): scripts/cad-reference.mjs, cases rack-*.
     */
    rack: (opts: any = {}) => rack(module, opts ?? {}),

    /**
     * A filament spool arm that bolts onto 2020 aluminium extrusion.
     * @remarks First-party, from published facts (Misumi HFS5-2020's 20mm
     *   profile and 6mm slot, ISO M5 clearance and head sizes, 1 kg spool
     *   sizes) - no portable OpenSCAD source exists; see the module.
     */
    extrusionSpoolArm: (opts: any = {}) => extrusionSpoolArm(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * A split pipe clamp: two bolted half-rings, laid out side by side to print.
     * @remarks First-party, from published facts (ISO socket heads, hex nuts and
     *   clearance holes; the pipe's diameter is the user's) - no portable
     *   OpenSCAD source exists; see the module. Returns TWO bodies by design.
     */
    pipeClamp: (opts: any = {}) => pipeClamp(module, { segments: segmentsFor(opts), ...(opts ?? {}) }),

    /**
     * A rack of cup pockets on a stable base.
     * @remarks The failure this replaces was a 6mm-thick plate with four holes
     *   in it: one valid solid of exactly the right footprint that cannot hold a
     *   mug, because a mug is 95-100mm tall and the plate was 6mm. Nothing in the
     *   pipeline compares proportions against purpose, so the pockets are DEEP by
     *   construction here - a cup sits down inside the rack rather than through
     *   it.
     * @param opts count (defaults to a square grid), cupDiameter, columns,
     *   rows, pocketDepth, wall, clearance.
     */
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

    /**
     * Lays solids end to end along Z (or x/y) from a base at the origin.
     * @remarks Use this to assemble coaxial parts - a body with a flange at each
     *   end, a stack of plates - instead of adding up half-heights. See
     *   stackAlong for why that arithmetic is the usual cause of detached parts.
     */
    stack: (solids: any[], opts: any = {}) => stackAlong(solids, axisIndex(opts.axis)),

    /**
     * Rounds the part's existing edges with radius r, leaving its outer
     * dimensions alone. "minkowski" cuts real geometry (an opening, so the
     * result stays inside the original bounds); "smooth" is tangent-based and
     * cosmetic.
     * @remarks The mode actually used is reported on stats.filletMode so
     *   fidelity is never silently overstated (spec section 4). "smooth" is
     *   *not* dimension-preserving - it moves the surface outward as well.
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

    /**
     * Breaks the part's existing edges with radius r, leaving its outer
     * dimensions alone.
     * @remarks Manifold is a mesh kernel with no exact chamfer primitive, so
     *   this uses the same ball opening as filletEdges; the difference between
     *   a round and a flat break is not something this kernel can express
     *   exactly. Both are reported as "minkowski".
     */
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
  };

  const result = helpers as PreludeHelpers;
  Object.defineProperty(result, "lastFilletMode", { get: () => lastFilletMode });
  Object.defineProperty(result, "lastFilletQuality", { get: () => lastFilletQuality });
  return result;
}
