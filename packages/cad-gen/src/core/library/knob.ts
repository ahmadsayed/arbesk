/**
 * Port of knob(), star_shape() and round_shape() from
 * https://github.com/mmalecki/openscad-knobs, MIT, by Maciej Małecki; credited
 * in ATTRIBUTED_HELPERS (../attribution.ts). Built at the original's $fn = 50 so
 * it matches OpenSCAD's render (cad-reference cases knob-*).
 *
 * Manifold has no children(), so the port returns the uncut solid and the
 * caller subtracts the bore. The nut catch (a GPL-adjacent submodule) is not ported.
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
  /** Head diameter (SCAD `d`). */
  d?: number;
  /** Head height (SCAD `h`). */
  h?: number;
  shape?: "star" | "round";
  chamfer?: number;
  /** 0 means no stem. */
  stemD?: number;
  /** 0 means no stem. */
  stemH?: number;
  starPoints?: number;
  center?: boolean;
  segments?: number;
}

/** A control knob face down on z = 0, with an optional stem from z = h to h + stemH. */
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
  const starShape = (points: number): any => {
    const arm = roundShape(d / 2, h);
    let body = roundShape((3 * d) / 4, h);
    for (let i = 0; i < points; i++) {
      // OpenSCAD's rotate(a) translate(t) means translate first in Manifold's method order.
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
