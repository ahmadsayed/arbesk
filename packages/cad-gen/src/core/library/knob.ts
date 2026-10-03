/**
 * A star- or round-profile control knob with an optional spacer stem, ported
 * from Maciej Małecki's knob.scad.
 * @remarks PORT of knob() (and star_shape()/round_shape()) from
 *   https://github.com/mmalecki/openscad-knobs (knob.scad), MIT, by Maciej
 *   Małecki (https://github.com/mmalecki). The credit is declared in
 *   ATTRIBUTED_HELPERS in ../attribution.ts. Licence checked before porting:
 *   GitHub's SPDX (MIT), Jev's reading of the LICENSE text and of the file's
 *   provenance (permissive, the repository's own work) and a human read
 *   agreed, via scripts/cad-candidates.mjs.
 *
 *   The original is fastener/axle-agnostic: it difference()s OpenSCAD
 *   children() translated to the top face, so the caller passes a nut catch or
 *   shaft bore as a child. Manifold has no children, so the port returns the
 *   UNCUTOFF solid and the caller subtracts the bore from the returned solid
 *   (see the catalog entry for the pattern).
 *
 *   The original pins $fn = 50, so every cylinder below is built with 50
 *   facets and the port reproduces OpenSCAD's render, not an approximation of
 *   it - see scripts/cad-reference.mjs, cases knob-*.
 *
 *   Not ported: the nut catch (catchnhole submodule, GPL-adjacent dependency
 *   the original pulls for nut="yes"); subtract a hex pocket per the fasteners
 *   entry instead.
 *
 *   ---------------------------------------------------------------------------
 *   MIT License
 *
 *   Copyright (C) 2022 by Maciej Małecki
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 *   IN THE SOFTWARE.
 */
import type { ManifoldModule } from "../../types.ts";

export interface KnobOptions {
  /** Diameter of the knob's base shape (SCAD `d`, the customizer's `head_d`). */
  d?: number;
  /** Height of the knob head (SCAD `h`, the customizer's `head_h`). */
  h?: number;
  /** "star" (default, rounded points around a central body) or "round". */
  shape?: "star" | "round";
  /** Edge chamfer on every cylinder of the profile (SCAD `chamfer`). */
  chamfer?: number;
  /** Stem (spacer) diameter; 0 means no stem (SCAD `stem_d`). */
  stemD?: number;
  /** Stem height; 0 means no stem (SCAD `stem_h`). */
  stemH?: number;
  /** Number of star points (SCAD `star_points`, star shape only). */
  starPoints?: number;
  /** Center the whole knob vertically on the origin (SCAD `center`). */
  center?: boolean;
  /** Facet count; the original pins $fn = 50. */
  segments?: number;
}

/**
 * A control knob, in the SCAD's frame: face down on z = 0, axis on the origin,
 * an optional stem rising from z = h to z = h + stemH.
 * @remarks The bottom edge of every profile cylinder is chamfered inward by
 *   `chamfer`, exactly as the source's d1 = d - 2 * chamfer cones.
 */
export function knob(module: ManifoldModule, opts: KnobOptions = {}): any {
  const { Manifold } = module as any;
  const d = opts.d ?? 32;
  const h = opts.h ?? 10;
  const shape = opts.shape ?? "star";
  const chamfer = opts.chamfer ?? 0.5;
  const stemD = opts.stemD ?? 15;
  const stemH = opts.stemH ?? 5;
  const starPoints = opts.starPoints ?? 4;
  const segs = opts.segments ?? 50;
  if (!(d > 4 * chamfer && h > chamfer && chamfer >= 0)) {
    throw new Error("knob: needs d > 4 * chamfer, h > chamfer and chamfer >= 0");
  }
  if (shape === "star" && !(starPoints >= 2 && Number.isInteger(starPoints))) {
    throw new Error("knob: star shape needs an integer starPoints >= 2");
  }

  // round_shape(d, h, chamfer): a chamfered cylinder, base at z = 0.
  const roundShape = (dia: number, height: number): any =>
    Manifold.cylinder(chamfer, (dia - 2 * chamfer) / 2, dia / 2, segs)
      .add(Manifold.cylinder(height - chamfer, dia / 2, dia / 2, segs).translate([0, 0, chamfer]));

  // star_shape(d, h, points, chamfer): a central round body plus one
  // round_shape arm per point at radius d/4 (SCAD `outset`).
  const starShape = (points: number): any => {
    const arm = roundShape(d / 2, h);
    let body = roundShape((3 * d) / 4, h);
    for (let i = 0; i < points; i++) {
      // OpenSCAD rotate(a) translate(t) nests t INSIDE the rotated frame, so
      // the translate chains before the rotate in Manifold's post-multiplied
      // method order.
      body = body.add(arm.translate([d / 4, 0, 0]).rotate([0, 0, (i * 360) / points]));
    }
    return body;
  };

  let part = shape === "star" ? starShape(starPoints) : roundShape(d, h);
  if (stemH !== 0) {
    part = part.add(Manifold.cylinder(stemH, stemD / 2, stemD / 2, segs).translate([0, 0, h]));
  }
  if (opts.center === true) {
    part = part.translate([0, 0, -(h + stemH) / 2]);
  }
  return part;
}
