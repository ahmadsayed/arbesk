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
  "rect", "circle", "roundRect", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "filletEdges", "chamferEdges",
  "bbox", "volume",
] as const;

export interface PreludeHelpers {
  /** Fillet strategy actually used, for stats reporting. */
  readonly lastFilletMode?: "exact" | "minkowski" | "smooth";
  [name: string]: unknown;
}

let lastFilletMode: "exact" | "minkowski" | "smooth" | undefined;

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
export function buildPrelude(module: ManifoldModule): PreludeHelpers {
  lastFilletMode = undefined;
  const { Manifold, CrossSection } = module;

  /** Cuts one axis-aligned hole; the two in-plane coordinates come from opts.at. */
  const cutHole = (part: any, opts: any): any => {
    const { diameter, axis, at, through = true } = opts ?? {};
    if (!(diameter > 0)) throw new Error("hole needs a positive diameter");
    const a = axisIndex(axis);
    const box = part.boundingBox();
    const span = box.max[a] - box.min[a];
    const depth = through ? span * 2 : (opts.depth ?? span);
    const cutter = alignToAxis(
      Manifold.cylinder(depth, diameter / 2, diameter / 2, 64, true), axis,
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
  const openByBall = (part: any, r: number, label: string): any => {
    const ball = Manifold.sphere(r, 32);
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

  const roundRect = (w: number, d: number, r: number): any => {
    const radius = Math.max(0, Math.min(r, Math.min(w, d) / 2));
    if (radius === 0) return CrossSection.square([w, d], true);
    return CrossSection.square([w - 2 * radius, d - 2 * radius], true)
      .offset(radius, "Round", 2, 64);
  };

  const helpers: Record<string, unknown> = {
    box: (w: number, d: number, h: number) => Manifold.cube([w, d, h], true),

    cylinder: (r: number, h: number, opts: any = {}) =>
      Manifold.cylinder(h, r, r, opts.segments ?? 64, true),

    sphere: (r: number, opts: any = {}) => Manifold.sphere(r, opts.segments ?? 64),

    rect: (w: number, d: number) => CrossSection.square([w, d], true),

    circle: (r: number, opts: any = {}) => CrossSection.circle(r, opts.segments ?? 64),

    roundRect,

    extrude: (profile: any, h: number, opts: any = {}) =>
      Manifold.extrude(profile, h, opts.nDivisions ?? 0, opts.twistDegrees ?? 0,
        uniformScale(opts.scaleTop), true),

    revolve: (profile: any, opts: any = {}) =>
      Manifold.revolve(profile, opts.segments ?? 64, opts.degrees ?? 360),

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
      if (!(r > 0)) return part;
      if (mode === "smooth") {
        lastFilletMode = "smooth";
        return part.smoothOut(60, 1).refineToLength(r / 2);
      }
      lastFilletMode = "minkowski";
      return openByBall(part, r, "filletEdges");
    },

    /**
     * Breaks the part's existing edges with radius r, leaving its outer
     * dimensions alone.
     * @remarks Manifold is a mesh kernel with no exact chamfer primitive, so
     *   this uses the same ball opening as filletEdges; the difference between
     *   a round and a flat break is not something this kernel can express
     *   exactly. Both are reported as "minkowski".
     */
    chamferEdges: (part: any, r: number) => {
      if (!(r > 0)) return part;
      lastFilletMode = "minkowski";
      return openByBall(part, r, "chamferEdges");
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
  return result;
}
