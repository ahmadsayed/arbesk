/**
 * A screw-mounted J-shaped wall hook, ported from AaronVerDow's
 * parametrized_wall_hook.scad.
 * @remarks PORT of wall_hook() from https://github.com/AaronVerDow/cad
 *   (parametrized_wall_hook.scad), released into the public domain under the
 *   Unlicense, by AaronVerDow (https://github.com/AaronVerDow). The Unlicense
 *   asks for no notice; the author is credited anyway, through
 *   ATTRIBUTED_HELPERS in ../attribution.ts. Licence checked before porting:
 *   GitHub's SPDX (Unlicense), Jev's reading of the LICENSE text (permissive)
 *   and a human read agreed.
 *
 *   The hook is a half ring, a wall plate down one side and a tip up the other,
 *   rounded by minkowski() with a 12-sided disc, with two countersunk screw
 *   holes through the plate. Manifold's minkowskiSum is the same exact
 *   operation, so the port reproduces OpenSCAD's render rather than
 *   approximating it - see scripts/cad-reference.mjs, cases wall-hook-*.
 */
import type { ManifoldModule } from "../../types.ts";

export interface WallHookOptions {
  /** Extrusion width of the hook (SCAD `width`). */
  width?: number;
  /** Material thickness (SCAD `thick`, defaults to width). */
  thick?: number;
  /** Centre-line diameter of the hook's curve (SCAD `d`, defaults to 33 + width). */
  d?: number;
  /** Height of the wall plate (SCAD `height`). */
  height?: number;
  /** Height of the tip (SCAD `theight`). */
  theight?: number;
  /** Facets of the rounding disc (SCAD `roundsegs`). */
  roundsegs?: number;
}

/**
 * OpenSCAD's fragment count for a radius with no $fn ($fa = 12, $fs = 2).
 * @remarks The SCAD leaves $fn unset for the hook's own cylinders.
 */
function fragments(r: number): number {
  return Math.ceil(Math.max(Math.min(360 / 12, (r * 2 * Math.PI) / 2), 5));
}

/** One wall hook, in the SCAD's frame: the curve centred on the origin, the plate up +y. */
export function wallHook(module: ManifoldModule, opts: WallHookOptions = {}): any {
  const { Manifold } = module as any;
  const width = opts.width ?? 12;
  const thick = opts.thick ?? width;
  const d = opts.d ?? 33 + width;
  const height = opts.height ?? 70;
  const theight = opts.theight ?? 30;
  const roundsegs = opts.roundsegs ?? 12;
  const rad = d / 2;
  const roundrad = thick / 2 - 0.1;
  const sthick = thick - roundrad * 2;
  if (!(width > 1 && thick > 0.2 && rad > thick && height > 10 && theight > 0)) {
    throw new Error("wallHook: needs width > 1, d/2 > thick, height > 10 and theight > 0");
  }

  const outerR = rad + sthick / 2;
  const innerR = rad - sthick / 2;
  const hook = Manifold.cylinder(width - 1, outerR, outerR, fragments(outerR))
    .subtract(Manifold.cylinder(width + 1, innerR, innerR, fragments(innerR)).translate([0, 0, -1]))
    .subtract(Manifold.cube([2 * rad + 2 * sthick, rad + sthick, width + 4]).translate([-rad - sthick, 0, -1]));
  const wall = Manifold.cube([sthick, height, width - 1]).translate([-rad - sthick / 2, 0, 0]);
  const tip = Manifold.cube([sthick, theight, width - 1]).translate([rad - sthick / 2, 0, 0]);
  const disc = Manifold.cylinder(1, roundrad, roundrad, roundsegs, true);
  let part = hook.add(wall).add(tip).minkowskiSum(disc).translate([0, 0, 0.5]);

  const screwAt = (y: number) => {
    const shank = Manifold.cylinder(15, 1.5, 1.5, 12, true).rotate([0, 90, 0]).translate([-rad, y, width / 2]);
    const sink = Manifold.cylinder(5, 1.5, 6, 12, true).rotate([0, 90, 0]).translate([-rad + thick / 2, y, width / 2]);
    return shank.add(sink);
  };
  part = part.subtract(screwAt(height - 10));
  if (height > 30) part = part.subtract(screwAt(theight));
  return part;
}
