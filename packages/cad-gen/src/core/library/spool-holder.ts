/**
 * A parametric multipart filament spool holder, ported from Matthew Burke's
 * 3dthings-filament-spool-holder.
 * @remarks PORT of filament_spool_holder.scad
 *   (https://github.com/Burke9077/3dthings-filament-spool-holder), MIT, by
 *   Matthew Burke (https://github.com/Burke9077). Credited to the user through
 *   ATTRIBUTED_HELPERS in ../attribution.ts. Licence checked before porting:
 *   GitHub's SPDX (MIT), Jev's reading of the LICENSE text (permissive, no
 *   third-party code in the file) and a human read all agreed.
 *
 *   The SCAD names and arithmetic are kept verbatim (in camelCase) so each line
 *   can be checked against the original. Verified against OpenSCAD's own render
 *   of every ported part: scripts/cad-reference.mjs, cases spool-*.
 *
 *   Ported: the four print parts - side_frame, crossbar, axle, axle_cap. Not
 *   ported: the assembly previews, the linking clip and the test pieces.
 *
 *   ---------------------------------------------------------------------------
 *   MIT License
 *
 *   Copyright (c) 2026 Matthew Burke
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */
import type { ManifoldModule } from "../../types.ts";

/** The SCAD customizer parameters, in camelCase, with the SCAD defaults. */
export const SPOOL_HOLDER_DEFAULTS = {
  part: "side_frame" as "side_frame" | "crossbar" | "axle" | "axle_cap",
  spoolMaxDiameter: 220,
  spoolMaxBoreDiameter: 60,
  spoolMaxWidth: 115,
  spoolSideClearance: 5,
  baseDepth: 175,
  spoolFloorClearance: 15,
  spoolRailClearance: 15,
  frameThickness: 8,
  frameWeb: 14,
  frameCornerRadius: 7,
  frameShoulderHeight: 34,
  baseTieHeight: 11,
  axleSlotWall: 7,
  railDepth: 20,
  railHeight: 18,
  railInset: 16,
  railCenterHeight: 17,
  railFitClearance: 0.30,
  railTenonDepth: 4,
  railTenonShoulder: 2.5,
  axleDiameter: 18,
  axleFacets: 32,
  axleSlotClearance: 0.35,
  axleOverhang: 11,
  axleCapDiameter: 27,
  axleCapSocketDepth: 8,
  axleCapEndThickness: 3,
  axleCapFitClearance: 0.25,
  m3HoleDiameter: 3.4,
  m3NutAcrossFlats: 5.5,
  m3NutThickness: 2.4,
  m3NutClearance: 0.25,
};

export type SpoolHolderOptions = Partial<typeof SPOOL_HOLDER_DEFAULTS>;

const EPSILON = 0.02;
const DEG = Math.PI / 180;

/**
 * OpenSCAD's fragment count for a circle of radius r with no $fn set
 * ($fa = 12, $fs = 2): get_fragments_from_r. Used so offset() rounds its
 * corners with the same polygon OpenSCAD does, and the volumes agree.
 */
function fragments(r: number): number {
  return Math.ceil(Math.max(Math.min(360 / 12, (r * 2 * Math.PI) / 2), 5));
}

/** The hidden derived values, verbatim from the SCAD. */
function derive(p: typeof SPOOL_HOLDER_DEFAULTS) {
  const insideWidth = p.spoolMaxWidth + 2 * p.spoolSideClearance;
  const spoolRadius = p.spoolMaxDiameter / 2;
  const spoolCenterDrop = (p.spoolMaxBoreDiameter - p.axleDiameter) / 2;
  const railCenterOffset = p.baseDepth / 2 - p.railInset;
  const railTop = p.railCenterHeight + p.railHeight / 2;
  const spoolCenterHeight = Math.max(
    spoolRadius + p.spoolFloorClearance,
    railTop + spoolRadius + p.spoolRailClearance,
  );
  const axleHeight = spoolCenterHeight + spoolCenterDrop;
  const axleSlotRadius = p.axleDiameter / 2 + p.axleSlotClearance;
  const frameTop = axleHeight + axleSlotRadius + p.axleSlotWall;
  const frameOuterWidth = insideWidth + 2 * p.frameThickness;
  const railTenonCrossDepth = p.railDepth - 2 * p.railTenonShoulder;
  const railTenonHeight = p.railHeight - 2 * p.railTenonShoulder;
  const windowCornerRadius = Math.min(6, p.frameWeb / 2);
  const nutPocketWidth = p.m3NutAcrossFlats + 2 * p.m3NutClearance;
  return {
    insideWidth, spoolRadius, railCenterOffset, axleHeight, axleSlotRadius, frameTop,
    railTenonCrossDepth, railTenonHeight, windowCornerRadius, nutPocketWidth,
    railTotalLength: insideWidth + 2 * p.railTenonDepth,
    railSocketDepth: p.railTenonDepth + p.railFitClearance,
    axleLength: frameOuterWidth + 2 * p.axleOverhang,
    axlePrintCenterZ: (p.axleDiameter / 2) * Math.cos((180 / p.axleFacets) * DEG),
    windowHalfWidth: railCenterOffset - railTenonCrossDepth / 2 - p.frameWeb * 0.60,
    windowTop: axleHeight - axleSlotRadius - p.axleSlotWall - 1,
    nutPocketLength: p.m3NutThickness + 2 * p.m3NutClearance,
    nutPocketCornerDiameter: nutPocketWidth / Math.cos(30 * DEG),
  };
}

type Derived = ReturnType<typeof derive>;

/**
 * The SCAD's own asserts, so a bad request is refused with its message rather
 * than producing a frame that does not hold a spool.
 */
function check(p: typeof SPOOL_HOLDER_DEFAULTS, d: Derived): void {
  const rules: [boolean, string][] = [
    [p.spoolMaxDiameter > p.axleDiameter, "spoolMaxDiameter must exceed axleDiameter"],
    [p.spoolMaxBoreDiameter > p.axleDiameter, "spoolMaxBoreDiameter must exceed axleDiameter"],
    [p.spoolMaxBoreDiameter < p.spoolMaxDiameter - 8, "leave at least 4 mm of spool flange outside the center bore"],
    [p.baseDepth > 2 * (p.railInset + p.railDepth / 2), "baseDepth is too small for the selected rail placement"],
    [p.railCenterHeight + p.railHeight / 2 < p.frameShoulderHeight, "rail sockets must remain inside the frame shoulders"],
    [d.railTenonCrossDepth > d.nutPocketWidth + 2, "rail tenon is too narrow for the M3 nut pocket"],
    [d.railSocketDepth < p.frameThickness - 2.5, "blind rail socket must leave at least 2.5 mm at the outside face"],
    [d.windowHalfWidth > d.windowCornerRadius + 5, "frame opening is too narrow; increase baseDepth or reduce web/rail size"],
    [d.windowTop > p.baseTieHeight + 20, "frame opening is too short for the selected spool envelope"],
    [p.axleOverhang >= p.axleCapSocketDepth + 1, "axleOverhang must exceed axleCapSocketDepth"],
    [p.axleCapDiameter > p.axleDiameter + 2, "axle caps need at least 1 mm of wall per side"],
  ];
  const failed = rules.find(([ok]) => !ok);
  if (failed) throw new Error("spoolHolder: " + failed[1]);
}

/** offset(r = r) polygon(points): the SCAD's rounded profiles. */
function roundedPolygon(module: ManifoldModule, points: number[][], r: number): any {
  const { CrossSection } = module as any;
  return CrossSection.ofPolygons([points], "NonZero").offset(r, "Round", 2, fragments(r));
}

/** side_frame_print(): the flat-printed A-frame side, with its cradle and rail sockets. */
function sideFrame(module: ManifoldModule, p: typeof SPOOL_HOLDER_DEFAULTS, d: Derived): any {
  const { Manifold, CrossSection } = module as any;
  const halfDepth = p.baseDepth / 2;
  const r = p.frameCornerRadius;
  const outer = roundedPolygon(module, [
    [-halfDepth + r, r], [halfDepth - r, r], [halfDepth - r, p.frameShoulderHeight - r],
    [0, d.frameTop - r], [-halfDepth + r, p.frameShoulderHeight - r],
  ], r);
  const wr = d.windowCornerRadius;
  const window = roundedPolygon(module, [
    [-d.windowHalfWidth + wr, p.baseTieHeight + wr], [d.windowHalfWidth - wr, p.baseTieHeight + wr],
    [0, d.windowTop - wr],
  ], wr);
  const leadIn = 2;
  const cradle = CrossSection.circle(d.axleSlotRadius, 64).translate([0, d.axleHeight]).add(
    CrossSection.ofPolygons([[
      [-d.axleSlotRadius, d.axleHeight], [-d.axleSlotRadius - leadIn, d.frameTop + EPSILON],
      [d.axleSlotRadius + leadIn, d.frameTop + EPSILON], [d.axleSlotRadius, d.axleHeight],
    ]], "NonZero"),
  );
  let frame = Manifold.extrude(outer.subtract(window).subtract(cradle), p.frameThickness);
  for (const side of [-1, 1]) {
    frame = frame.subtract(Manifold.cube([
      d.railTenonCrossDepth + 2 * p.railFitClearance,
      d.railTenonHeight + 2 * p.railFitClearance,
      d.railSocketDepth + EPSILON,
    ]).translate([
      side * d.railCenterOffset - d.railTenonCrossDepth / 2 - p.railFitClearance,
      p.railCenterHeight - d.railTenonHeight / 2 - p.railFitClearance,
      p.frameThickness - d.railSocketDepth,
    ]));
    frame = frame.subtract(Manifold.cylinder(
      p.frameThickness + 2 * EPSILON, p.m3HoleDiameter / 2, p.m3HoleDiameter / 2, 32,
    ).translate([side * d.railCenterOffset, p.railCenterHeight, -EPSILON]));
  }
  return frame;
}

/** crossbar_print(): a rail with shouldered tenons, a bolt tunnel and two nut traps. */
function crossbar(module: ManifoldModule, p: typeof SPOOL_HOLDER_DEFAULTS, d: Derived): any {
  const { Manifold } = module as any;
  let bar = Manifold.cube([d.insideWidth, p.railDepth, p.railHeight])
    .translate([-d.insideWidth / 2, -p.railDepth / 2, 0]);
  const tenonX = d.insideWidth / 2 + p.railTenonDepth / 2;
  for (const side of [-1, 1]) {
    bar = bar.add(Manifold.cube([p.railTenonDepth, d.railTenonCrossDepth, d.railTenonHeight], true)
      .translate([side * tenonX, 0, p.railHeight / 2]));
  }
  bar = bar.subtract(Manifold.cylinder(
    d.railTotalLength + 2 * EPSILON, p.m3HoleDiameter / 2, p.m3HoleDiameter / 2, 32,
  ).rotate([0, 90, 0]).translate([-d.railTotalLength / 2 - EPSILON, 0, p.railHeight / 2]));
  for (const side of [-1, 1]) {
    const x = side * tenonX;
    const r = d.nutPocketCornerDiameter / 2;
    bar = bar
      .subtract(Manifold.cylinder(d.nutPocketLength, r, r, 6, true).rotate([0, 90, 0])
        .translate([x, 0, p.railHeight / 2]))
      .subtract(Manifold.cube([d.nutPocketLength, d.nutPocketWidth, p.railHeight / 2 + EPSILON])
        .translate([x - d.nutPocketLength / 2, -d.nutPocketWidth / 2, p.railHeight / 2]));
  }
  return bar;
}

/** axle_print(): the faceted axle lying on its flat. */
function axle(module: ManifoldModule, p: typeof SPOOL_HOLDER_DEFAULTS, d: Derived): any {
  const { Manifold } = module as any;
  const r = p.axleDiameter / 2;
  return Manifold.cylinder(d.axleLength, r, r, p.axleFacets, true)
    .rotate([0, 0, 180 / p.axleFacets])
    .rotate([0, 90, 0])
    .translate([0, 0, d.axlePrintCenterZ]);
}

/** axle_cap_print(): a closed cap that pushes onto the axle end. */
function axleCap(module: ManifoldModule, p: typeof SPOOL_HOLDER_DEFAULTS): any {
  const { Manifold } = module as any;
  const capHeight = p.axleCapSocketDepth + p.axleCapEndThickness;
  const socketR = (p.axleDiameter + p.axleCapFitClearance) / 2;
  return Manifold.cylinder(capHeight, p.axleCapDiameter / 2, p.axleCapDiameter / 2, 64)
    .subtract(Manifold.cylinder(p.axleCapSocketDepth + EPSILON, socketR, socketR, p.axleFacets)
      .rotate([0, 0, 180 / p.axleFacets])
      .translate([0, 0, p.axleCapEndThickness]));
}

/**
 * One print part of the spool holder, in the SCAD's print orientation.
 * @param opts Any SCAD customizer parameter, camelCased, plus `part`.
 */
export function spoolHolder(module: ManifoldModule, opts: SpoolHolderOptions = {}): any {
  const p = { ...SPOOL_HOLDER_DEFAULTS, ...opts };
  const d = derive(p);
  check(p, d);
  switch (p.part) {
    case "side_frame": return sideFrame(module, p, d);
    case "crossbar": return crossbar(module, p, d);
    case "axle": return axle(module, p, d);
    case "axle_cap": return axleCap(module, p);
    default:
      throw new Error("spoolHolder: unknown part '" + String(p.part) +
        "'. Use 'side_frame' (print 2), 'crossbar' (2), 'axle' (1) or 'axle_cap' (2).");
  }
}
