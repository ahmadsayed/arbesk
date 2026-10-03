/**
 * Gridfinity bins ("cups"), ported from vector76's gridfinity_openscad.
 * @remarks PORT of basic_cup() and the modules it calls in
 *   gridfinity_cup_modules.scad and gridfinity_modules.scad
 *   (https://github.com/vector76/gridfinity_openscad), MIT, by Jamie
 *   (https://github.com/vector76). Credited to the user through
 *   ATTRIBUTED_HELPERS in ../attribution.ts. Licence checked before porting:
 *   GitHub's SPDX (MIT), Jev's reading of the LICENSE text and of each file's
 *   provenance (permissive, the repository's own work) and a human read agreed.
 *   Gridfinity itself is Zack Freedman's open standard; its dimensions are
 *   facts and carry no credit of their own.
 *
 *   Almost every surface here is a hull() of OpenSCAD cylinders and spheres, so
 *   the port hulls the SAME POINTS OpenSCAD tessellates those primitives into
 *   (circle angles 360*i/$fn, sphere rings at 180*(i+0.5)/rings). That is what
 *   lets the result match OpenSCAD's render, not merely resemble it - see
 *   scripts/cad-reference.mjs, cases gf-cup-*.
 *
 *   Not ported: half_pitch, efficient_floor and irregular_cup.
 *
 *   ---------------------------------------------------------------------------
 *   MIT License
 *
 *   Copyright (c) 2022 Jamie
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

/** The customizer of gridfinity_basic_cup.scad, camelCased, with its defaults. */
export const GRIDFINITY_CUP_DEFAULTS = {
  width: 2,
  depth: 1,
  height: 3,
  magnetDiameter: 0,
  screwDepth: 0,
  holeOverhangRemedy: true,
  boxCornerAttachmentsOnly: false,
  filledIn: false,
  chambers: 1,
  withLabel: "disabled" as "disabled" | "left" | "right" | "center" | "leftchamber" | "rightchamber" | "centerchamber",
  fingerslide: true,
  labelWidth: 0,
  floorThickness: 0.7,
  wallThickness: 0.95,
  lipStyle: "normal" as "normal" | "reduced" | "none",
};

export type GridfinityCupOptions = Partial<typeof GRIDFINITY_CUP_DEFAULTS>;

const PITCH = 42;
const ZPITCH = 7;
const CLEARANCE = 0.5;
const SEVENTEEN = PITCH / 2 - 4;
const DEG = Math.PI / 180;

type V3 = [number, number, number];

// ------------------------------------------------- OpenSCAD's tessellation

/** cylinder(r1, r2, h, $fn) at z0, as the points OpenSCAD builds it from. */
function cylPts(r1: number, r2: number, h: number, fn: number, z0 = 0): V3[] {
  const ring = (r: number, z: number): V3[] => r === 0 ? [[0, 0, z]]
    : Array.from({ length: fn }, (_, i) => [r * Math.cos(2 * Math.PI * i / fn), r * Math.sin(2 * Math.PI * i / fn), z]);
  return [...ring(r1, z0), ...ring(r2, z0 + h)];
}

/** sphere(r, $fn) at c: OpenSCAD's rings at phi = 180*(i+0.5)/rings. */
function spherePts(r: number, fn: number, c: V3 = [0, 0, 0]): V3[] {
  const rings = Math.floor((fn + 1) / 2);
  const pts: V3[] = [];
  for (let i = 0; i < rings; i++) {
    const phi = (180 * (i + 0.5)) / rings * DEG;
    const rr = r * Math.sin(phi);
    const z = r * Math.cos(phi);
    for (let j = 0; j < fn; j++) {
      const t = 2 * Math.PI * j / fn;
      pts.push([c[0] + rr * Math.cos(t), c[1] + rr * Math.sin(t), c[2] + z]);
    }
  }
  return pts;
}

const shift = (pts: V3[], d: V3): V3[] => pts.map(([x, y, z]) => [x + d[0], y + d[1], z + d[2]]);

/** cornercopy(r, nx, ny): the four extreme corners of an nx x ny block. */
function corners(r: number, nx: number, ny: number): [number, number][] {
  const xs = [-r, PITCH * (nx - 1) + r];
  const ys = [-r, PITCH * (ny - 1) + r];
  return xs.flatMap((x) => ys.map((y) => [x, y] as [number, number]));
}

/** hull() cornercopy(r, nx, ny) { children }, children given as a point set. */
function cornerHull(module: ManifoldModule, r: number, nx: number, ny: number, pts: V3[]): any {
  const { Manifold } = module as any;
  return Manifold.hull(corners(r, nx, ny).flatMap(([x, y]) => shift(pts, [x, y, 0])));
}

// ------------------------------------------------------- gridfinity_modules

/** pad_oversize(num_x, num_y, margins): one base pad, or the stacking cut-out. */
function padOversize(module: ManifoldModule, nx = 1, ny = 1, margins = false): any {
  const { Manifold } = module as any;
  const radialgap = margins ? 0.25 : 0;
  const axialdown = margins ? 0.1 : 0;
  const lower = cornerHull(module, SEVENTEEN, nx, ny, [
    ...cylPts(0.8 + radialgap, 0.8 + radialgap, 0.1, 24),
    ...cylPts(1.6 + radialgap, 1.6 + radialgap, 1.9, 32, 0.8),
  ]);
  const upper = cornerHull(module, SEVENTEEN, nx, ny,
    cylPts(1.6 + radialgap, (7.5 + 0.5 + 2 * radialgap + 2 * 0.2) / 2, 5 - 2.6 + 0.2, 32, 2.6));
  let pad = lower.add(upper);
  if (margins) {
    pad = pad.subtract(Manifold.cube([PITCH * nx, PITCH * ny, axialdown]).translate([-PITCH / 2, -PITCH / 2, 0]));
  }
  return pad.translate([0, 0, -axialdown]);
}

/** pad_grid(num_x, num_y): the feet, rounded over on a fractional far side. */
function padGrid(module: ManifoldModule, nx: number, ny: number): any {
  const cutX = nx < 1;
  const cutY = ny < 1;
  let one = padOversize(module);
  if (cutX) one = one.intersect(padOversize(module).translate([PITCH * (-1 + nx), 0, 0]));
  if (cutY) one = one.intersect(padOversize(module).translate([0, PITCH * (-1 + ny), 0]));
  if (cutX && cutY) one = one.intersect(padOversize(module).translate([PITCH * (-1 + nx), PITCH * (-1 + ny), 0]));
  let grid: any;
  for (let xi = 0; xi < Math.ceil(nx); xi++) {
    for (let yi = 0; yi < Math.ceil(ny); yi++) {
      const p = one.translate([PITCH * xi, PITCH * yi, 0]);
      grid = grid ? grid.add(p) : p;
    }
  }
  return grid;
}

/** Whether a cell-corner offset `side` of cell `i` (1-based) is on the block's edge. */
const outermost = (i: number, side: number, n: number): boolean =>
  (i === 1 && side === -1) || (i === n && side === 1);

/** gridcopycorners(nx, ny, r, onlyBoxCorners): one copy per cell corner. */
function cellCorners(nx: number, ny: number, r: number, onlyBox: boolean): [number, number][] {
  const range = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
  const offsets: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return range(nx).flatMap((xi) => range(ny).flatMap((yi) => offsets
    // The SCAD's four box-corner cases are exactly "outermost in x AND in y".
    .filter(([xx, yy]) => !onlyBox || (outermost(xi, xx, nx) && outermost(yi, yy, ny)))
    .map(([xx, yy]) => [PITCH * (xi - 1) + xx * r, PITCH * (yi - 1) + yy * r] as [number, number])));
}

/** The magnet, screw and overhang-remedy cuts under the feet. */
function attachmentCuts(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS): any[] {
  const { Manifold } = module as any;
  const suppress = p.width < 1 || p.depth < 1;
  const emd = suppress ? 0 : p.magnetDiameter;
  const esd = suppress ? 0 : p.screwDepth;
  const magnetThickness = 2.4;
  const at = cellCorners(Math.ceil(p.width), Math.ceil(p.depth),
    Math.min(PITCH / 2 - 8, PITCH / 2 - 4 - emd / 2), p.boxCornerAttachmentsOnly);
  const cuts: any[] = [];
  const place = (solid: any) => at.forEach(([x, y]) => cuts.push(solid.translate([x, y, 0])));
  if (esd > 0) place(Manifold.cylinder(esd + 0.1, 1.5, 1.5, 28).translate([0, 0, -0.1]));
  if (emd > 0) place(Manifold.cylinder(magnetThickness + 0.1, emd / 2, emd / 2, 41).translate([0, 0, -0.1]));
  if (p.holeOverhangRemedy && emd > 0 && esd > 0) {
    place(Manifold.cube([emd, 3, 0.3 + 0.1]).translate([-emd / 2, -1.5, 0])
      .intersect(Manifold.cylinder(1, emd / 2, emd / 2, 41))
      .translate([0, 0, magnetThickness - 0.1]));
  }
  return cuts;
}

/** grid_block(): the solid, stackable block every bin is carved from. */
function gridBlock(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS): any {
  const { Manifold } = module as any;
  const cornerRadius = 3.75;
  const blockCorner = (PITCH - CLEARANCE) / 2 - cornerRadius;
  const totalht = ZPITCH * p.height + 3.75;
  const body = padGrid(module, p.width, p.depth).add(
    Manifold.cube([PITCH * p.width, PITCH * p.depth, totalht - 5]).translate([-PITCH / 2, -PITCH / 2, 5]));
  const crop = cornerHull(module, blockCorner, p.width, p.depth,
    cylPts(cornerRadius, cornerRadius, totalht + 0.2, 32, -0.1));
  let block = body.intersect(crop)
    .subtract(padOversize(module, p.width, p.depth, true).translate([0, 0, ZPITCH * p.height]));
  for (const cut of attachmentCuts(module, p)) block = block.subtract(cut);
  return block;
}

// --------------------------------------------------- gridfinity_cup_modules

/** The bowl geometry basic_cavity() derives from the options. */
function cavityDims(p: typeof GRIDFINITY_CUP_DEFAULTS) {
  const q = 1.65 - p.wallThickness + 0.95;
  const zpoint = Math.max(5 + p.floorThickness, ZPITCH * p.height - 1.2);
  const magHt = p.magnetDiameter > 0 ? 2.4 : 0;
  const floorht = Math.max(magHt, p.screwDepth, 5) + p.floorThickness;
  const lip2 = p.height < 1.8 && p.lipStyle === "normal" ? "reduced" : p.lipStyle;
  const lip = p.height < 1.2 && lip2 === "reduced" ? "none" : lip2;
  return { q, zpoint, floorht, lip };
}

/** The top of the bowl's corner hull, for each lip style. */
function bowlTopPts(lip: string, q: number, zpoint: number): V3[] {
  const q2 = 0.1;
  if (lip === "reduced") {
    return [...cylPts(1.85, 1.85, 0.1, 32, zpoint + 1.8), ...cylPts(1.15 + q, 1.15 + q, q2, 32, zpoint - (q - 0.7) + 1.9 - q2)];
  }
  if (lip === "none") return cylPts(1.15 + q, 1.15 + q, 6, 32, zpoint);
  return [...cylPts(1.15, 1.15, 0.1, 24, zpoint - 0.1), ...cylPts(1.15 + q, 1.15 + q, q2, 32, zpoint - q - q2)];
}

/** The 13 rotated slabs that leave the rounded finger slide behind. */
function fingerslideCuts(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS, floorht: number, lip: string): any[] {
  const { Manifold } = module as any;
  const facets = 13;
  const pivotZ = 13.6 - 0.45 + floorht - 5 + SEVENTEEN - 17;
  const pivotY = -10;
  const slideY = lip === "reduced" ? -0.7 : lip === "none" ? SEVENTEEN + 1.15 - PITCH / 2 + 0.25 + p.wallThickness : 0;
  const slab = Manifold.cube([PITCH * p.width, 10, ZPITCH * p.height + 5]).translate([-PITCH / 2, -10 - SEVENTEEN - 1.15, 0]);
  return Array.from({ length: facets }, (_, ai) => slab.translate([0, -pivotY, -pivotZ])
    .rotate([90 * ai / (facets - 1), 0, 0]).translate([0, pivotY, pivotZ]).translate([0, slideY, 0]));
}

/** For a bin narrower than one cell: the hull that cuts its side lips away. */
function halfWidthLips(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS, floorht: number): any {
  const { Manifold } = module as any;
  const xs = [-PITCH / 2 + 1.5 + 0.25 + p.wallThickness, -PITCH / 2 + p.width * PITCH - 1.5 - 0.25 - p.wallThickness];
  const ys = [-10, (p.depth - 0.5) * PITCH - SEVENTEEN];
  return Manifold.hull(xs.flatMap((x) => ys.flatMap((y) =>
    shift(cylPts(1.5, 1.5, 7 * p.height, 24), [x, y, (floorht + 7 * p.height) / 2]))));
}

/** basic_cavity(): the bowl, its lip and the finger slide. */
function basicCavity(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS): any {
  const { q, zpoint, floorht, lip } = cavityDims(p);
  const eps = 0.1;
  const lipCut = cornerHull(module, SEVENTEEN, p.width, p.depth, cylPts(1.15, 1.15, 1.2 + 2 * eps, 24, zpoint - eps));
  const bottomZ = 2.3 / 2 + q + floorht;
  const bowl = cornerHull(module, SEVENTEEN, p.width, p.depth, [
    ...bowlTopPts(lip, q, zpoint),
    ...spherePts(1.15 + q, 32, [0, 0, bottomZ]),
    // mirror([0,0,1]) cylinder(d1=2.3+2q, d2=0, h=1.15+q): a cone pointing down
    ...cylPts(1.15 + q, 1.15 + q, 0, 32, bottomZ), [0, 0, bottomZ - (1.15 + q)],
  ]);
  let cavity = lipCut.add(bowl);
  if (p.fingerslide) for (const cut of fingerslideCuts(module, p, floorht, lip)) cavity = cavity.subtract(cut);
  return p.width < 1 ? cavity.add(halfWidthLips(module, p, floorht)) : cavity;
}

/** The label tab: a hull of six spheres along the back wall of one chamber. */
function labelBar(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS, start: number, lenUnits: number): any {
  const { Manifold } = module as any;
  const barD = 1.2;
  const zpoint = ZPITCH * p.height;
  const yz = [
    [(p.depth - 0.5) * PITCH - 14, zpoint - barD / 2],
    [(p.depth - 0.5) * PITCH, zpoint - barD / 2],
    [(p.depth - 0.5) * PITCH, zpoint - barD / 2 - 10.18],
  ];
  const x0 = -PITCH / 2 + start * PITCH;
  return Manifold.hull(yz.flatMap(([y, z]) => [
    ...spherePts(barD / 2, 24, [x0, y, z]), ...spherePts(barD / 2, 24, [x0 + Math.abs(lenUnits) * PITCH, y, z]),
  ]));
}

/** The label bars partitioned_cavity() keeps, one per chamber when asked. */
function labelBars(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS, seps: number[]): any[] {
  if (p.withLabel === "disabled") return [];
  const whole = seps.length < 1 || p.labelWidth === 0 || ["left", "center", "right"].includes(p.withLabel);
  const widths = whole ? [p.width]
    : seps.map((s, i) => s - (i === 0 ? 0 : seps[i - 1])).concat([p.width - seps[seps.length - 1]]);
  return widths.map((w, i) => {
    const start = i === 0 ? 0 : seps[i - 1];
    const lw = p.labelWidth === 0 || p.labelWidth > w ? w : p.labelWidth;
    const pos = p.withLabel.startsWith("center") ? (w - lw) / 2 : p.withLabel.startsWith("right") ? w - lw : 0;
    return labelBar(module, p, start + pos, lw);
  });
}

/** partitioned_cavity(): the bowl minus the dividing walls and the label tab. */
function partitionedCavity(module: ManifoldModule, p: typeof GRIDFINITY_CUP_DEFAULTS): any {
  const { Manifold } = module as any;
  const pitch = p.width / p.chambers;
  const seps = Array.from({ length: p.chambers - 1 }, (_, i) => (i + 1) * pitch);
  let cavity = basicCavity(module, p);
  for (const s of seps) {
    cavity = cavity.subtract(Manifold.cube([1.2, PITCH * p.depth, ZPITCH * (p.height + 1)])
      .translate([PITCH * (-0.5 + s) - 0.6, -PITCH / 2, 0]));
  }
  for (const bar of labelBars(module, p, seps)) cavity = cavity.subtract(bar);
  return cavity;
}

const LIP_STYLES = ["normal", "reduced", "none"];
const LABEL_STYLES = ["disabled", "left", "right", "center", "leftchamber", "rightchamber", "centerchamber"];

/**
 * Why a string option came out wrong, said so the caller can fix it.
 * @remarks PARAMETERS hold numbers only, so a model that wants an editable label
 *   style reaches for a lookup table - labelMap[P.labelIdx] - and passes
 *   undefined when the index misses. attempt#14 lost three repair rounds to
 *   exactly that, two of them on a crash ("startsWith is not a function") that
 *   named nothing it could change.
 */
const STRING_HINT = " - write the string literally in the call: a PARAMETER cannot hold a string";
const gotten = (v: unknown): string => " (got " + (typeof v === "string" ? "'" + v + "'" : String(v)) + ")";

/** Refuses what the port does not support, and what the SCAD would get wrong. */
function check(p: typeof GRIDFINITY_CUP_DEFAULTS): void {
  const rules: [boolean, string][] = [
    [p.width > 0 && p.depth > 0 && p.height > 0, "width, depth and height must be positive"],
    [Number.isInteger(p.chambers) && p.chambers >= 1, "chambers must be a whole number, 1 or more"],
    [p.width >= 1 || p.width === 0.5, "width is whole grid units, or 0.5"],
    [Number.isInteger(p.depth), "depth is whole grid units"],
    [LIP_STYLES.includes(p.lipStyle), "lipStyle is one of " + LIP_STYLES.join(", ") + STRING_HINT + gotten(p.lipStyle)],
    [LABEL_STYLES.includes(p.withLabel), "withLabel is one of " + LABEL_STYLES.join(", ") + STRING_HINT + gotten(p.withLabel)],
  ];
  const failed = rules.find(([ok]) => !ok);
  if (failed) throw new Error("gridfinityCup: " + failed[1]);
}

/**
 * A Gridfinity bin: basic_cup(), or grid_block() when filledIn.
 * @remarks Frame as in the SCAD: the first cell is centred on the origin, the
 *   bin extends +x and +y in 42mm cells, and its feet sit on z = 0.
 */
export function gridfinityCup(module: ManifoldModule, opts: GridfinityCupOptions = {}): any {
  const p = { ...GRIDFINITY_CUP_DEFAULTS, ...opts };
  check(p);
  const block = gridBlock(module, p);
  return p.filledIn ? block : block.subtract(partitionedCavity(module, p));
}
