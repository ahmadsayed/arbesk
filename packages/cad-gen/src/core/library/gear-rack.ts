/**
 * A straight gear rack - the linear gear a spur gear drives - ported from BOSL2.
 * @remarks PORT of rack2d() and the straight (non-helical) branch of rack()
 *   from https://github.com/BelfrySCAD/BOSL2 (gears.scad), BSD-2-Clause, by
 *   Adrian Mariano (https://github.com/adrianVmariano) and Revar Desmera
 *   (https://github.com/revarbat), with the BOSL2 contributors.
 *   The credit is declared in ATTRIBUTED_HELPERS in ../attribution.ts.
 *
 *   Licence checked before porting: GitHub's SPDX is BSD-2-Clause and Jev read
 *   the LICENSE as permissive, but scripts/cad-candidates.mjs flagged the
 *   file's provenance - its header says "Inspired by code by Leemon Baird,
 *   2011". A human read (2026-10-10) settled it: the rest of gears.scad is
 *   BOSL2's own work, and Leemon Baird's 2011 "Public Domain Parametric
 *   Involute Spur Gear" (thingiverse.com/thing:5505) is public domain, usable
 *   for any purpose. So the port carries BOSL2's BSD-2 notice below and a
 *   courtesy credit to Baird.
 *
 *   Faithful to the original: the trapezoidal tooth with BOSL2's four-point
 *   fillets (clearance radius at the root, pitch/16 at the tip), its addendum
 *   (module x (1 + profileShift)) and dedendum (module x (1 - profileShift) +
 *   clearance, clearance defaulting to module/4), and its base depth (2 x
 *   dedendum + addendum unless backing, width or bottom is given). Verified
 *   against OpenSCAD's render of BOSL2's own rack(): scripts/cad-reference.mjs,
 *   cases rack-*. rackOutline also carries rack2d()'s helical branch (the
 *   tooth on its transverse pitch and pressure angle), which worm() sweeps;
 *   the rack() helper itself stays straight. Not ported: helical and
 *   herringbone rack solids.
 *
 *   ---------------------------------------------------------------------------
 *   BSD 2-Clause License
 *
 *   Copyright (c) 2017-2019, Revar Desmera
 *   All rights reserved.
 *
 *   Redistribution and use in source and binary forms, with or without
 *   modification, are permitted provided that the following conditions are met:
 *
 *   1. Redistributions of source code must retain the above copyright notice,
 *      this list of conditions and the following disclaimer.
 *
 *   2. Redistributions in binary form must reproduce the above copyright
 *      notice, this list of conditions and the following disclaimer in the
 *      documentation and/or other materials provided with the distribution.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *   ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *   LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *   CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *   INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *   CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *   ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *   POSSIBILITY OF SUCH DAMAGE.
 */
import type { ManifoldModule } from "../../types.ts";

type Pt = [number, number];

/**
 * BOSL2 arc(n, r, corner=[p0, p1, p2]): n points along the circle of radius r
 * tangent to segments p1-p0 and p1-p2, ordered from the p0 side to the p2 side.
 */
function cornerArc(n: number, r: number, p0: Pt, p1: Pt, p2: Pt): Pt[] {
  const unit = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return [dx / len, dy / len];
  };
  const u0 = unit(p1, p0);
  const u2 = unit(p1, p2);
  const half = Math.acos(Math.max(-1, Math.min(1, u0[0] * u2[0] + u0[1] * u2[1]))) / 2;
  const reach = r / Math.tan(half);
  const t0: Pt = [p1[0] + u0[0] * reach, p1[1] + u0[1] * reach];
  const t2: Pt = [p1[0] + u2[0] * reach, p1[1] + u2[1] * reach];
  const bis = unit([0, 0], [u0[0] + u2[0], u0[1] + u2[1]]);
  const centre: Pt = [p1[0] + (bis[0] * r) / Math.sin(half), p1[1] + (bis[1] * r) / Math.sin(half)];
  const a0 = Math.atan2(t0[1] - centre[1], t0[0] - centre[0]);
  let sweep = Math.atan2(t2[1] - centre[1], t2[0] - centre[0]) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (sweep * i) / (n - 1);
    out.push([centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)]);
  }
  return out;
}

/** The rack's resolved dimensions, mm. */
export interface RackSpec {
  module: number;
  teeth: number;
  thickness: number;
  pressureAngle: number;
  backlash: number;
  clearance: number;
  profileShift: number;
  addendum: number;
  dedendum: number;
  bottom: number;
  /** Helix angle in degrees: rack2d() lays the tooth out on its transverse section. 0 is straight. */
  helical: number;
}

/** Throws when a rack option is outside what BOSL2's rack() accepts. */
function assertRackBasics(o: any): void {
  if (!(o.module > 0)) throw new Error("rack needs a positive module");
  if (!Number.isInteger(o.teeth) || o.teeth < 1) throw new Error("rack needs a whole number of teeth, at least 1");
  if (!(o.thickness > 0)) throw new Error("rack needs a positive thickness (its face width)");
  const pa = o.pressureAngle ?? 20;
  if (!(pa >= 0 && pa < 90)) throw new Error("rack needs a pressureAngle between 0 and 90 degrees");
  if ([o.backing, o.width, o.bottom].filter((v) => v !== undefined).length > 1) {
    throw new Error("rack takes only one of backing, width and bottom");
  }
}

/**
 * Depth from the pitch line to the base, as BOSL2 resolves it: bottom as
 * given, width less the addendum, backing plus the dedendum, or by default
 * 2 x dedendum + addendum.
 */
function rackBottom(o: any, addendum: number, dedendum: number): number {
  if (o.bottom !== undefined) {
    if (!(o.bottom > dedendum)) throw new Error("rack: bottom must be deeper than the dedendum (" + dedendum.toFixed(3) + ")");
    return o.bottom;
  }
  if (o.width !== undefined) {
    if (!(o.width > addendum + dedendum)) throw new Error("rack: width must exceed the tooth height (" + (addendum + dedendum).toFixed(3) + ")");
    return o.width - addendum;
  }
  if (o.backing !== undefined) {
    if (!(o.backing > 0)) throw new Error("rack: backing must be positive");
    return o.backing + dedendum;
  }
  return 2 * dedendum + addendum;
}

/**
 * Resolves rack options the way BOSL2's rack() does.
 * @throws Error naming the option at fault.
 */
export function resolveRackSpec(o: any): RackSpec {
  assertRackBasics(o);
  const m = o.module;
  const profileShift = o.profileShift ?? 0;
  const clearance = o.clearance ?? 0.25 * m;
  const addendum = m * (1 + profileShift);
  const dedendum = m * (1 - profileShift) + clearance;
  return {
    module: m, teeth: o.teeth, thickness: o.thickness, pressureAngle: o.pressureAngle ?? 20,
    backlash: o.backlash ?? 0, clearance, profileShift, addendum, dedendum,
    bottom: rackBottom(o, addendum, dedendum),
    helical: 0,
  };
}

/** rack2d()'s closed outline: teeth along +X centred on x = 0, tips toward +Y, base at y = -bottom. */
export function rackOutline(s: RackSpec): Pt[] {
  const beta = (s.helical * Math.PI) / 180;
  const pitch = (s.module * Math.PI) / Math.cos(beta);
  const pa = (s.pressureAngle * Math.PI) / 180;
  const transPa = Math.atan(Math.tan(pa) / Math.cos(beta));
  const tthick = (pitch / Math.PI) * (Math.PI / 2 + 2 * s.profileShift * Math.tan(pa)) - s.backlash;
  const ax = s.addendum * Math.tan(transPa);
  const dx = s.dedendum * Math.tan(transPa);
  const poff = tthick / 2;
  const a = s.addendum;
  const d = s.dedendum;
  const clear = s.clearance;
  const tooth: Pt[] = [
    [-pitch / 2, -d],
    ...cornerArc(4, clear, [-pitch / 2, -d], [-poff - dx, -d], [-poff + ax, a]),
    ...cornerArc(4, pitch / 16, [-poff - dx, -d], [-poff + ax, a], [poff - ax, a]),
    ...cornerArc(4, pitch / 16, [-poff + ax, a], [poff - ax, a], [poff + dx, -d]),
    ...cornerArc(4, clear, [poff - ax, a], [poff + dx, -d], [pitch / 2, -d]),
    [pitch / 2, -d],
  ];
  const path: Pt[] = [];
  for (let i = 0; i < s.teeth; i++) {
    const x = (i - (s.teeth - 1) / 2) * pitch;
    for (const [px, py] of tooth) path.push([px + x, py]);
  }
  return [[path[0][0], -s.bottom], ...path, [path[path.length - 1][0], -s.bottom]];
}

/**
 * The rack solid: teeth along X, tips toward +Z, face width along Y, centred
 * on x and y, base at z = -bottom - BOSL2's rack() with its default anchor.
 */
export function rack(module: ManifoldModule, opts: any): any {
  const { Manifold, CrossSection } = module as any;
  const s = resolveRackSpec(opts ?? {});
  // rackOutline runs clockwise, like BOSL2's path; Manifold fills counter-clockwise.
  const outline = rackOutline(s).reverse();
  // BOSL2 extrudes the profile in XY and turns it upright with xrot(90).
  const flat = Manifold.extrude(CrossSection.ofPolygons([outline]), s.thickness, 0, 0, [1, 1], true);
  return flat.rotate([90, 0, 0]);
}
