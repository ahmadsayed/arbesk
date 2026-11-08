/**
 * Port of wall_hook() from https://github.com/AaronVerDow/cad
 * (parametrized_wall_hook.scad), Unlicense, by AaronVerDow; credited anyway in
 * ATTRIBUTED_HELPERS (../attribution.ts). minkowskiSum matches OpenSCAD's
 * minkowski() exactly (cad-reference cases wall-hook-*).
 */
import type { ManifoldModule } from "../../types.ts";

export interface WallHookOptions {
  /** SCAD `width`. */
  width?: number;
  /** SCAD `thick`; defaults to width. */
  thick?: number;
  /** Centre-line diameter of the curve (SCAD `d`); defaults to 33 + width. */
  d?: number;
  /** SCAD `height`. */
  height?: number;
  /** Tip height (SCAD `theight`). */
  theight?: number;
  /** SCAD `roundsegs`. */
  roundsegs?: number;
}

/** OpenSCAD's fragment count with no $fn ($fa = 12, $fs = 2). */
function fragments(r: number): number {
  return Math.ceil(Math.max(Math.min(360 / 12, (r * 2 * Math.PI) / 2), 5));
}

/** In the SCAD's frame: curve centred on the origin, plate up +y. */
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
