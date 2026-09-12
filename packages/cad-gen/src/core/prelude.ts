/**
 * The curated CAD prelude injected into every script.
 * @remarks This module defines the *published API* the model is prompted
 *   against. Adding, removing or renaming a helper is a breaking change to
 *   PRELUDE_VERSION (spec section 4).
 */
import type { ManifoldModule } from "../types.ts";

/** Helper names injected into every script, in injection order. */
export const PRELUDE_NAMES = [
  "box", "cylinder", "sphere",
  "rect", "circle", "roundRect", "polygon", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "spurGear", "gridfinityBase", "standoffs", "phoneStand", "stack",
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
// The 7mm height unit, the 26mm magnet/screw square and the 6.5mm magnet holes
// are quoted in SYSTEM_PROMPT's STANDARDS section rather than kept here: no
// helper reads them, and a constant nothing reads is a constant that drifts.

/** Involute samples per flank. More is smoother and slower. */
const GEAR_FLANK_STEPS = 8;

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

/** The four radii every spur gear is defined by. */
function gearRadii(m: number, z: number, phi: number): GearRadii {
  const pitch = (m * z) / 2;
  return {
    pitch,
    base: pitch * Math.cos(phi),
    tip: pitch + GEAR_ADDENDUM * m,
    root: pitch - GEAR_DEDENDUM * m,
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
function spurOutlinePoints(m: number, z: number, phi: number, steps: number): number[][] {
  const radii = gearRadii(m, z, phi);
  const points: number[][] = [];
  for (let i = 0; i < z; i++) {
    for (const p of toothPoints(i, z, phi, radii, steps)) points.push(p);
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
    const shift = [0, 0, 0];
    shift[axis] = cursor - box.min[axis];
    const placed = solid.translate(shift);
    out = out ? out.add(placed) : placed;
    cursor += box.max[axis] - box.min[axis];
  }
  return out;
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
   *   convex. Passing i0 == i1 gives the straight riser.
   */
  const baseSegment = (
    w: number, d: number, i0: number, z0: number, i1: number, z1: number,
  ): any => {
    // The wafers sit INSIDE the segment: the lower one grows upward from z0 and
    // the upper one ends at z1, so the hull spans exactly z0..z1. Centring them
    // on z0 and z1 would put 0.005mm of slop on the ends, and Gridfinity has no
    // room for slop.
    const eps = 0.01;
    return Manifold.hull([
      slab(w - 2 * i0, d - 2 * i0, GF_CORNER_RADIUS - i0, z0, z0 + eps),
      slab(w - 2 * i1, d - 2 * i1, GF_CORNER_RADIUS - i1, z1 - eps, z1),
    ]);
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
     *   parallel, at centre distance (module x (z1 + z2)) / 2.
     */
    spurGear: (opts: any = {}) => {
      const o = opts ?? {};
      const phi = ((o.pressureAngle ?? 20) * Math.PI) / 180;
      const bore = o.bore ?? 0;
      const radii = gearRadii(o.module, o.teeth, phi);
      assertGearSpec(o.module, o.teeth, o.thickness, bore, radii.root);
      const solid = Manifold.extrude(
        CrossSection.ofPolygons([spurOutlinePoints(o.module, o.teeth, phi, o.steps ?? GEAR_FLANK_STEPS)]),
        o.thickness, 0, 0, [1, 1], true,
      );
      if (!(bore > 0)) return solid;
      return solid.subtract(
        Manifold.cylinder(o.thickness + 2, bore / 2, bore / 2, segmentsFor(undefined), true),
      );
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
      const outer = o.diameter ?? 6;
      const height = o.height ?? 5;
      if (!Array.isArray(holes) || holes.length === 0) {
        throw new Error("standoffs needs a non-empty list of [x, y] positions");
      }
      let out: any = null;
      for (const [x, y] of holes) {
        let post: any = Manifold.cylinder(height, outer / 2, outer / 2, segmentsFor(undefined), true)
          .translate([x, y, height / 2]);
        if (o.screw > 0) {
          post = post.subtract(
            Manifold.cylinder(height + 2, o.screw / 2, o.screw / 2, segmentsFor(undefined), true)
              .translate([x, y, height / 2]),
          );
        }
        out = out ? out.add(post) : post;
      }
      return out;
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
