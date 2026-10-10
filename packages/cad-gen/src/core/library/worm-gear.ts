/**
 * A worm and the worm gear it drives - a high-ratio drive between crossed shafts - ported from BOSL2.
 * @remarks PORT of worm(), worm_gear() and worm_dist() from
 *   https://github.com/BelfrySCAD/BOSL2 (gears.scad), BSD-2-Clause, by
 *   Adrian Mariano (https://github.com/adrianVmariano) and Revar Desmera
 *   (https://github.com/revarbat), with the BOSL2 contributors. The credit is
 *   declared in ATTRIBUTED_HELPERS in ../attribution.ts. Licence and
 *   provenance as for the rack port (gear-rack.ts): BOSL2's own work, with
 *   Leemon Baird's public-domain 2011 involute gear as its inspiration.
 *
 *   Faithful to the original's construction. The worm: the lead angle
 *   asin(starts x module / diameter), rack2d()'s tooth on the transverse
 *   pitch, and BOSL2's grid of rings - each ring samples the rack profile,
 *   shifted along the axis by the lead as it goes round, so the thread is a
 *   helix. The worm gear: the gear's involute tooth (helical, on the worm's
 *   lead angle) swept round the virtual worm across worm_arc, sheared along
 *   the face by the lead, crowned by crowning, resampled to `slices` and
 *   closed by twisted flat faces, then copied round the gear. The tooth is
 *   spurGear's (passed in), so it is the same involute as every other gear
 *   here. Verified against OpenSCAD's render of BOSL2's own worm() and
 *   worm_gear(): scripts/cad-reference.mjs, cases worm-* and wormgear-*.
 *
 *   Deliberate differences: leftHanded on wormGear MIRRORS the gear. BOSL2's
 *   worm_gear() accepts left_handed but never applies it (it only reaches an
 *   unused shear variable), so its left-handed gear is right-handed and would
 *   not mesh with its own left-handed worm. And a worm gear needs at least 18
 *   teeth: below that BOSL2 profile-shifts the teeth automatically, which no
 *   gear in this library does. Not ported: enveloping worms, profile shift,
 *   backlash and clearance options.
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
import { rackOutline, resolveRackSpec } from "./gear-rack.ts";
import { sideFaces, signedVolume } from "./triangle-soup.ts";
import type { Vec3 } from "./triangle-soup.ts";

/**
 * One gear tooth: centred on +Y, pitch point at the origin, mirror-symmetric,
 * root to root (+X side first), with an EVEN point count.
 * @param helical Helix angle in degrees: the tooth is laid out on its transverse section.
 */
export type WormTooth = (module: number, teeth: number, pressureAngle: number, helical: number) => number[][];

const DEG = Math.PI / 180;
/** BOSL2's dedendum, 1 + clearance (module / 4), in modules. */
const DEDENDUM = 1.25;
/**
 * Vertices a worm may spend, about half the 200 000-triangle delivery budget.
 * @remarks BOSL2's grid puts a ring every lead / steps along the axis, so the
 *   count is length / (pitch x starts) x steps^2: a fine, long worm (module
 *   0.5, 80 mm) is 417 000 triangles at 64 segments. steps comes down until it
 *   fits, never below BOSL2's own 36.
 */
const WORM_VERTEX_BUDGET = 50000;
/** Fewest teeth a worm gear builds without profile shift: BOSL2's floor(2 / sin(20 deg)^2). */
const MIN_WORM_GEAR_TEETH = 18;

const isWholeAtLeast = (v: unknown, n: number): boolean => Number.isInteger(v) && (v as number) >= n;

/** The worm's lead angle, asin(starts x module / diameter), in degrees. */
function leadAngle(caller: string, module: number, starts: number, diameter: number): number {
  const sine = (starts * module) / diameter;
  if (!(sine < 1)) {
    throw new Error(caller + ": " + starts + " start(s) of module " + module + " do not fit a " + diameter +
      " mm worm; use a larger diameter or fewer starts");
  }
  return Math.asin(sine) / DEG;
}

/** Throws when a pressure angle is outside 0-90 degrees. */
function assertPressureAngle(caller: string, pa: number): void {
  if (!(pa >= 0 && pa < 90)) throw new Error(caller + " needs a pressureAngle between 0 and 90 degrees");
}

export interface WormSpec {
  module: number;
  diameter: number;
  length: number;
  starts: number;
  leftHanded: boolean;
  pressureAngle: number;
  bore: number;
  /** Ring samples round the axis: BOSL2's max(36, segments), capped by WORM_VERTEX_BUDGET. */
  steps: number;
  /** Degrees. */
  lead: number;
}

/** Each worm option check and the refusal it gives, in the order they are tried. */
const WORM_RULES: [(o: any) => boolean, string][] = [
  [(o) => o.module > 0, "worm needs a positive module"],
  [(o) => o.diameter > 0, "worm needs a positive diameter (its pitch diameter)"],
  [(o) => o.length > 0, "worm needs a positive length"],
  [(o) => isWholeAtLeast(o.starts ?? 1, 1), "worm needs a whole number of starts, at least 1"],
  [(o) => (o.bore ?? 0) >= 0, "worm needs a non-negative bore"],
];

/** Validates worm options and fills BOSL2's defaults. */
export function resolveWormSpec(o: any): WormSpec {
  const broken = WORM_RULES.find(([ok]) => !ok(o));
  if (broken) throw new Error(broken[1]);
  const pressureAngle = o.pressureAngle ?? 20;
  assertPressureAngle("worm", pressureAngle);
  const starts = o.starts ?? 1;
  const bore = o.bore ?? 0;
  const root = o.diameter - 2 * DEDENDUM * o.module;
  if (bore >= root) {
    throw new Error("worm: a " + bore + " mm bore does not fit inside the root diameter of " + root.toFixed(2) + " mm");
  }
  const lead = leadAngle("worm", o.module, starts, o.diameter);
  const pitch = (o.module * Math.PI) / Math.cos(lead * DEG);
  const affordable = Math.floor(Math.sqrt((WORM_VERTEX_BUDGET * pitch * starts) / o.length));
  return {
    module: o.module, diameter: o.diameter, length: o.length, starts, leftHanded: Boolean(o.leftHanded),
    pressureAngle, bore, steps: Math.max(36, Math.min(Math.round(o.segments ?? 36), affordable)), lead,
  };
}

/** OpenSCAD lookup(): linear interpolation over a [key, value] table, clamped at both ends. */
function lookupIn(table: number[][]): (key: number) => number {
  const sorted = [...table].sort((a, b) => a[0] - b[0]);
  return (key) => {
    if (key <= sorted[0][0]) return sorted[0][1];
    const hi = sorted.findIndex(([k]) => k >= key);
    if (hi < 0) return sorted[sorted.length - 1][1];
    if (sorted[hi][0] === key || hi === 0) return sorted[hi][1];
    const [k0, v0] = sorted[hi - 1];
    const [k1, v1] = sorted[hi];
    return v0 + ((v1 - v0) * (key - k0)) / (k1 - k0);
  };
}

/**
 * The worm's thread height above its pitch cylinder, by axial position.
 * @remarks BOSL2: rack2d()'s single tooth on the transverse pitch, mirrored,
 *   repeated 2 x ceil(length / pitch) + 1 times along the axis.
 */
function threadProfile(s: WormSpec): { height: (z: number) => number; pitch: number } {
  const rackSpec = { ...resolveRackSpec({ module: s.module, teeth: 1, thickness: 1, pressureAngle: s.pressureAngle }), helical: s.lead };
  const tooth = rackOutline(rackSpec).slice(1, -1).map(([x, y]) => [-x, y]);
  const pitch = (s.module * Math.PI) / Math.cos(s.lead * DEG);
  const copies = 2 * Math.ceil(s.length / pitch) + 1;
  const table: number[][] = [];
  for (let k = 0; k < copies; k++) {
    const shift = (k - (copies - 1) / 2) * pitch;
    for (const [x, y] of tooth) table.push([x + shift, y]);
  }
  return { height: lookupIn(table), pitch };
}

/** A fan closing a ring that is star-shaped about `centre`. */
function capFaces(base: number, ringSize: number, centre: number): number[][] {
  return Array.from({ length: ringSize }, (_v, i) => [centre, base + ((i + 1) % ringSize), base + i]);
}

/**
 * Rings of `ringSize` vertices, capped top and bottom by fans to the axis, wound outward.
 * @param alt Quad diagonal style, as sideFaces: the worm uses BOSL2's "alt".
 */
function closedRings(verts: Vec3[], ringSize: number, alt = false): { verts: Vec3[]; faces: number[][] } {
  const rings = verts.length / ringSize;
  const first = verts[0][2];
  const last = verts[verts.length - 1][2];
  const bottom = verts.length;
  const top = bottom + 1;
  const all: Vec3[] = [...verts, [0, 0, first], [0, 0, last]];
  const faces = [
    ...sideFaces(rings, ringSize, alt),
    ...capFaces(0, ringSize, bottom).map((f) => [...f].reverse()),
    ...capFaces((rings - 1) * ringSize, ringSize, top),
  ];
  return { verts: all, faces: signedVolume(all, faces) < 0 ? faces.map((f) => [...f].reverse()) : faces };
}

/**
 * The worm's vertices and triangles: axis on Z, centred, right-handed unless leftHanded.
 * @remarks BOSL2's grid: ring j at z = j x zstep - length / 2, sample i at
 *   angle 360 x (1 - u) + 90 with u = i / steps - 0.5, radius
 *   diameter / 2 + the thread height at z + pitch x starts x u.
 */
export function wormMesh(s: WormSpec): { verts: Vec3[]; faces: number[][] } {
  const { height, pitch } = threadProfile(s);
  const zsteps = Math.ceil((s.length / pitch / s.starts) * s.steps);
  const zstep = s.length / zsteps;
  const hand = s.leftHanded ? -1 : 1;
  const verts: Vec3[] = [];
  for (let j = 0; j <= zsteps; j++) {
    const z = j * zstep - s.length / 2;
    for (let i = 0; i < s.steps; i++) {
      const u = i / s.steps - 0.5;
      const ang = (360 * (1 - u) + 90) * DEG;
      const r = s.diameter / 2 + height(z + pitch * s.starts * u);
      verts.push([hand * r * Math.cos(ang), r * Math.sin(ang), z]);
    }
  }
  return closedRings(verts, s.steps, true);
}

export interface WormGearSpec {
  module: number;
  teeth: number;
  wormDiameter: number;
  wormStarts: number;
  /** Degrees of the worm the gear wraps. */
  wormArc: number;
  crowning: number;
  leftHanded: boolean;
  pressureAngle: number;
  slices: number;
  bore: number;
  /** The worm's lead angle, degrees: the gear's helix angle. */
  lead: number;
  pitchRadius: number;
}

/** Each worm gear option check and the refusal it gives, in the order they are tried. */
const WORM_GEAR_RULES: [(o: any) => boolean, string][] = [
  [(o) => o.module > 0, "wormGear needs a positive module"],
  [(o) => isWholeAtLeast(o.teeth, MIN_WORM_GEAR_TEETH),
    "wormGear needs a whole number of teeth, at least " + MIN_WORM_GEAR_TEETH],
  [(o) => o.wormDiameter > 0, "wormGear needs the positive wormDiameter of the worm it meshes with"],
  [(o) => isWholeAtLeast(o.wormStarts ?? 1, 1), "wormGear needs a whole number of wormStarts, at least 1"],
  [(o) => (o.wormArc ?? 45) > 0 && (o.wormArc ?? 45) <= 90, "wormGear needs a wormArc above 0 and at most 90 degrees"],
  [(o) => (o.crowning ?? 0.1) >= 0, "wormGear needs a non-negative crowning"],
  [(o) => isWholeAtLeast(o.slices ?? 10, 1), "wormGear needs a whole number of slices, at least 1"],
  [(o) => (o.bore ?? 0) >= 0, "wormGear needs a non-negative bore"],
];

/** Validates worm gear options and fills BOSL2's defaults. */
export function resolveWormGearSpec(o: any): WormGearSpec {
  const broken = WORM_GEAR_RULES.find(([ok]) => !ok(o));
  if (broken) throw new Error(broken[1]);
  const pressureAngle = o.pressureAngle ?? 20;
  assertPressureAngle("wormGear", pressureAngle);
  const wormStarts = o.wormStarts ?? 1;
  const lead = leadAngle("wormGear", o.module, wormStarts, o.wormDiameter);
  const pitchRadius = (o.module * o.teeth) / 2 / Math.cos(lead * DEG);
  const bore = o.bore ?? 0;
  const root = 2 * (pitchRadius - DEDENDUM * o.module);
  if (bore >= root) {
    throw new Error("wormGear: a " + bore + " mm bore does not fit inside the root diameter of " + root.toFixed(2) + " mm");
  }
  return {
    module: o.module, teeth: o.teeth, wormDiameter: o.wormDiameter, wormStarts, wormArc: o.wormArc ?? 45,
    crowning: o.crowning ?? 0.1, leftHanded: Boolean(o.leftHanded), pressureAngle, slices: o.slices ?? 10,
    bore, lead, pitchRadius,
  };
}

/** BOSL2 resample_path(closed=false) on a smooth path: n points evenly spaced along its length. */
function resample(path: Vec3[], n: number): Vec3[] {
  const along = [0];
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    along.push(along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = along[along.length - 1];
  return Array.from({ length: n }, (_v, k) => {
    const at = n === 1 ? 0 : (total * k) / (n - 1);
    const i = Math.max(1, along.findIndex((d) => d >= at - 1e-12));
    const span = along[i] - along[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (at - along[i - 1]) / span));
    const [a, b] = [path[i - 1], path[i]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  });
}

/** Rotates [x, y, z] about the Z axis by `deg` degrees. */
function zrot(deg: number, [x, y, z]: Vec3): Vec3 {
  const c = Math.cos(deg * DEG);
  const sn = Math.sin(deg * DEG);
  return [x * c - y * sn, x * sn + y * c, z];
}

/** (a - b) folded into (-180, 180]: BOSL2 modang. */
function foldAngle(a: number): number {
  const m = ((a % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
}

/**
 * One tooth swept round the virtual worm: a row per tooth point, each running
 * across the face from z = +zmax to -zmax, in the worm's frame (worm axis on Y
 * through the origin, the tooth's pitch point at x = wormDiameter / 2).
 */
function toothRows(s: WormGearSpec, tooth: number[][]): Vec3[][] {
  // BOSL2: reverse(zrot(90, tooth)) on a tooth that starts at its -X root; this
  // tooth starts at +X, so the reverse cancels. It points toward the worm (-X).
  const profile: Vec3[] = tooth.map(([x, y]): Vec3 => [-y, x, 0]);
  const toothBottom = Math.max(...profile.map((p) => p[0]));
  const wr = s.wormDiameter / 2;
  const halfThickness = Math.sin((s.wormArc / 2) * DEG) * (wr + toothBottom);
  const arc = 2 * Math.asin(halfThickness / (wr + s.crowning + toothBottom)) / DEG;
  const oslices = s.slices * 4;
  const hand = s.leftHanded ? -1 : 1;
  const rows = profile.map(([px, py]) => Array.from({ length: oslices + 1 }, (_v, i): Vec3 => {
    const w = (arc * (i / oslices - 0.5)) * DEG;
    const x = px + wr + s.crowning;
    // yrot(w), then left(crowning) and back(L): the shear that follows the worm's lead.
    const lift = wr * w * Math.tan(s.lead * DEG);
    return [x * Math.cos(w) - s.crowning, py + hand * lift, -x * Math.sin(w)];
  }));
  const zs = rows.flat().map((p) => p[2]);
  const [minz, maxz] = [Math.min(...zs), Math.max(...zs)];
  const zmax = Math.max(Math.abs(minz), Math.abs(maxz)) + 0.05;
  const theta = (p: Vec3): number => Math.atan2(p[1], p[0]) / DEG;
  const twist = foldAngle(theta(rows[0][0]) - theta(rows[0][oslices])) / (maxz - minz);
  return rows.map((row) => {
    const r = resample(row, s.slices);
    const head = r[0];
    const tail = r[r.length - 1];
    return [
      zrot(twist * (zmax - head[2]), [head[0], head[1], zmax]),
      ...r,
      zrot(twist * (-zmax - tail[2]), [tail[0], tail[1], -zmax]),
    ];
  });
}

/**
 * The worm gear's vertices and triangles: axis on Z, centred on the origin,
 * tooth 0 pointing along +Y.
 * @remarks BOSL2 places each tooth with zrot(i x 360 / teeth) x
 *   back(pitchRadius) x zrot(-90) x left(wormDiameter / 2), then joins the
 *   rows across all teeth into rings.
 */
export function wormGearMesh(s: WormGearSpec, tooth: number[][]): { verts: Vec3[]; faces: number[][] } {
  const rows = toothRows(s, tooth);
  const across = rows[0].length;
  const wr = s.wormDiameter / 2;
  const placed: Vec3[][] = [];
  for (let t = 0; t < s.teeth; t++) {
    for (const row of rows) {
      placed.push(row.map(([x, y, z]) => zrot((360 * t) / s.teeth, [y, -(x - wr) + s.pitchRadius, z])));
    }
  }
  const verts: Vec3[] = [];
  for (let k = 0; k < across; k++) for (const row of placed) verts.push(row[k]);
  return closedRings(verts, placed.length);
}

/** A Manifold solid from a triangle soup, minus a bore along Z. */
function solidOf(module: ManifoldModule, mesh: { verts: Vec3[]; faces: number[][] }, bore: number): any {
  const { Manifold, Mesh } = module as any;
  const m = new Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.verts.flat()),
    triVerts: Uint32Array.from(mesh.faces.flat()),
  });
  m.merge();
  const solid = new Manifold(m);
  if (!(bore > 0)) return solid;
  const box = solid.boundingBox();
  const h = box.max[2] - box.min[2] + 2;
  return solid.subtract(Manifold.cylinder(h, bore / 2, bore / 2, 0, true));
}

/** The worm as a Manifold solid, axis on Z, centred. */
export function worm(module: ManifoldModule, opts: any): any {
  const s = resolveWormSpec(opts ?? {});
  return solidOf(module, wormMesh(s), s.bore);
}

/** The worm gear as a Manifold solid, axis on Z, centred, tooth 0 toward +Y. */
export function wormGear(module: ManifoldModule, opts: any, toothFor: WormTooth): any {
  const s = resolveWormGearSpec(opts ?? {});
  return solidOf(module, wormGearMesh(s, toothFor(s.module, s.teeth, s.pressureAngle, s.lead)), s.bore);
}

/**
 * Centre distance between a worm and its worm gear, in millimetres.
 * @remarks BOSL2 worm_dist() at profile shift 0 and backlash 0:
 *   (wormDiameter + module x teeth / cos(lead)) / 2.
 */
export function wormDistance(opts: any): number {
  const o = opts ?? {};
  if (!(o.module > 0)) throw new Error("wormDistance needs a positive module");
  if (!(o.wormDiameter > 0)) throw new Error("wormDistance needs a positive wormDiameter");
  if (!isWholeAtLeast(o.teeth, 1)) throw new Error("wormDistance needs the worm gear's whole number of teeth");
  const starts = o.wormStarts ?? 1;
  if (!isWholeAtLeast(starts, 1)) throw new Error("wormDistance needs a whole number of wormStarts, at least 1");
  const lead = leadAngle("wormDistance", o.module, starts, o.wormDiameter);
  return (o.wormDiameter + (o.module * o.teeth) / Math.cos(lead * DEG)) / 2;
}
