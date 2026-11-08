/**
 * Port of worm(), worm_gear() and worm_dist() from BOSL2 gears.scad
 * (https://github.com/BelfrySCAD/BOSL2), BSD-2-Clause, by Adrian Mariano and
 * Revar Desmera; credited in ATTRIBUTED_HELPERS (../attribution.ts). Verified
 * against OpenSCAD renders: scripts/cad-reference.mjs, cases worm-* and wormgear-*.
 *
 * Deliberate differences: leftHanded on wormGear mirrors the gear (BOSL2
 * accepts left_handed but never applies it), and a worm gear needs at least
 * 18 teeth because nothing here profile-shifts. Not ported: enveloping worms,
 * profile shift, backlash and clearance options.
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

/** One tooth centred on +Y, pitch point at the origin, +X root first, with an even point count. */
export type WormTooth = (module: number, teeth: number, pressureAngle: number, helical: number) => number[][];

const DEG = Math.PI / 180;
/** BOSL2's dedendum, 1 + clearance (module / 4), in modules. */
const DEDENDUM = 1.25;
/**
 * About half the 200 000-triangle budget. BOSL2's ring grid grows with
 * length x steps^2, so steps is reduced to fit, never below BOSL2's 36.
 */
const WORM_VERTEX_BUDGET = 50000;
/** Fewest teeth a worm gear builds without profile shift: BOSL2's floor(2 / sin(20 deg)^2). */
const MIN_WORM_GEAR_TEETH = 18;

const isWholeAtLeast = (v: unknown, n: number): boolean => Number.isInteger(v) && (v as number) >= n;

/** Lead angle in degrees: asin(starts x module / diameter). */
function leadAngle(caller: string, module: number, starts: number, diameter: number): number {
  const sine = (starts * module) / diameter;
  if (!(sine < 1)) {
    throw new Error(caller + ": " + starts + " start(s) of module " + module + " do not fit a " + diameter +
      " mm worm; use a larger diameter or fewer starts");
  }
  return Math.asin(sine) / DEG;
}

function assertPressureAngle(caller: string, pa: number): void {
  if (!(pa >= 0 && pa < 90)) throw new Error(caller + " needs a pressureAngle between 0 and 90 degrees");
}

interface WormSpec {
  module: number;
  diameter: number;
  length: number;
  starts: number;
  leftHanded: boolean;
  pressureAngle: number;
  bore: number;
  /** BOSL2's max(36, segments), capped by WORM_VERTEX_BUDGET. */
  steps: number;
  lead: number;
}

const WORM_RULES: [(o: any) => boolean, string][] = [
  [(o) => o.module > 0, "worm needs a positive module"],
  [(o) => o.diameter > 0, "worm needs a positive diameter (its pitch diameter)"],
  [(o) => o.length > 0, "worm needs a positive length"],
  [(o) => isWholeAtLeast(o.starts ?? 1, 1), "worm needs a whole number of starts, at least 1"],
  [(o) => (o.bore ?? 0) >= 0, "worm needs a non-negative bore"],
];

function resolveWormSpec(o: any): WormSpec {
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

/** OpenSCAD lookup(): linear interpolation, clamped at both ends. */
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

/** Thread height above the pitch cylinder by axial position: rack2d()'s tooth, repeated. */
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

/** Rings of `ringSize` vertices, capped by fans to the axis; `alt` is BOSL2's quad style. */
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

/** BOSL2's ring grid: ring j at z = j x zstep - length / 2, each sample shifted by the lead. */
function wormMesh(s: WormSpec): { verts: Vec3[]; faces: number[][] } {
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

interface WormGearSpec {
  module: number;
  teeth: number;
  wormDiameter: number;
  wormStarts: number;
  wormArc: number;
  crowning: number;
  leftHanded: boolean;
  pressureAngle: number;
  slices: number;
  bore: number;
  /** The worm's lead angle in degrees, used as the gear's helix angle. */
  lead: number;
  pitchRadius: number;
}

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

function resolveWormGearSpec(o: any): WormGearSpec {
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

/** BOSL2 resample_path(closed=false): n points evenly spaced along the path. */
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

function zrot(deg: number, [x, y, z]: Vec3): Vec3 {
  const c = Math.cos(deg * DEG);
  const sn = Math.sin(deg * DEG);
  return [x * c - y * sn, x * sn + y * c, z];
}

/** BOSL2 modang: an angle folded into (-180, 180]. */
function foldAngle(a: number): number {
  const m = ((a % 360) + 360) % 360;
  return m > 180 ? m - 360 : m;
}

/**
 * One tooth swept round the virtual worm, a row per tooth point, in the worm's
 * frame (worm axis on Y, pitch point at x = wormDiameter / 2).
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

/** Teeth placed as BOSL2 does, then joined into rings. Axis on Z, tooth 0 toward +Y. */
function wormGearMesh(s: WormGearSpec, tooth: number[][]): { verts: Vec3[]; faces: number[][] } {
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

export function worm(module: ManifoldModule, opts: any): any {
  const s = resolveWormSpec(opts ?? {});
  return solidOf(module, wormMesh(s), s.bore);
}

export function wormGear(module: ManifoldModule, opts: any, toothFor: WormTooth): any {
  const s = resolveWormGearSpec(opts ?? {});
  return solidOf(module, wormGearMesh(s, toothFor(s.module, s.teeth, s.pressureAngle, s.lead)), s.bore);
}

/** BOSL2 worm_dist(): (wormDiameter + module x teeth / cos(lead)) / 2. */
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
