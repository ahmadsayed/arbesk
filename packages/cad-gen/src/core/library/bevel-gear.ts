/**
 * A bevel gear - teeth on a cone, for shafts that meet at an angle - ported from BOSL2.
 * @remarks PORT of bevel_gear() from https://github.com/BelfrySCAD/BOSL2
 *   (gears.scad), BSD-2-Clause, by Adrian Mariano
 *   (https://github.com/adrianVmariano) and Revar Desmera
 *   (https://github.com/revarbat), with the BOSL2 contributors. The credit is
 *   declared in ATTRIBUTED_HELPERS in ../attribution.ts. Licence and
 *   provenance as for the rack port (gear-rack.ts): BOSL2's own work, with
 *   Leemon Baird's public-domain 2011 involute gear as its inspiration.
 *
 *   Faithful to the original's construction: the pitch angle
 *   atan(sin(shaftAngle) / (mateTeeth / teeth + cos(shaftAngle))), the outer
 *   cone distance pitchRadius / sin(pitchAngle), the default face width
 *   min(coneDistance / 3, 10 x module), and the sweep - each slice is the
 *   tooth profile scaled by its cone distance, tilted onto the pitch cone and
 *   turned along the cutter arc (which is what makes spiral teeth spiral) -
 *   with BOSL2's top faces, flat centre and conical backing. The tooth
 *   profile is spurGear's (passed in), so a bevel gear's teeth are the same
 *   involute as every other gear here. Verified against OpenSCAD's render of
 *   BOSL2's own bevel_gear(): scripts/cad-reference.mjs, cases bevel-*.
 *
 *   One deliberate difference: spiral: 0 here means STRAIGHT teeth (BOSL2's
 *   cutter_radius=0). BOSL2's spiral=0 alone gives "zerol" teeth, curved on a
 *   2 x faceWidth cutter, which nobody asking for "a bevel gear" means.
 *   Not ported: pitch angles of 90 degrees or more (crown and internal bevel
 *   gears), and BOSL2's thickness/bottom alternatives to backing.
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

type Vec3 = [number, number, number];

/** One tooth's outline: centred on +Y with its pitch point at the origin, mirror-symmetric. */
export type BevelTooth = (module: number, teeth: number, pressureAngle: number) => number[][];

const DEG = Math.PI / 180;
/** BOSL2's dedendum, 1 + clearance (module / 4), in modules. */
const DEDENDUM = 1.25;
/** BOSL2's default slice count along the face for spiral teeth. */
const SPIRAL_SLICES = 5;

export interface BevelSpec {
  module: number;
  teeth: number;
  mateTeeth: number;
  shaftAngle: number;
  pressureAngle: number;
  /** Spiral angle in degrees; 0 is a straight bevel gear. */
  spiral: number;
  rightHanded: boolean;
  slices: number;
  bore: number;
  /** Degrees. */
  pitchAngle: number;
  pitchRadius: number;
  /** Outer cone distance: apex to the outer end of the teeth along the pitch cone. */
  coneDistance: number;
  faceWidth: number;
  backing?: number;
}

/** The pitch angle BOSL2 gives a gear of `teeth` meshing with `mateTeeth`, in degrees. */
function pitchAngleOf(teeth: number, mateTeeth: number, shaftAngle: number): number {
  const a = Math.atan(Math.sin(shaftAngle * DEG) / (mateTeeth / teeth + Math.cos(shaftAngle * DEG))) / DEG;
  return ((a % 180) + 180) % 180;
}

const isWholeAtLeast3 = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 3;

/** Each option check and the refusal it gives, in the order they are tried. */
const BEVEL_RULES: [(o: any) => boolean, string][] = [
  [(o) => o.module > 0, "bevelGear needs a positive module"],
  [(o) => isWholeAtLeast3(o.teeth), "bevelGear needs a whole number of teeth, at least 3"],
  [(o) => isWholeAtLeast3(o.mateTeeth), "bevelGear needs a whole number of mateTeeth, at least 3"],
  [(o) => (o.shaftAngle ?? 90) > 0 && (o.shaftAngle ?? 90) < 180,
    "bevelGear needs a shaftAngle strictly between 0 and 180 degrees"],
  [(o) => (o.spiral ?? 0) >= 0 && (o.spiral ?? 0) < 90,
    "bevelGear needs a spiral angle from 0 up to (not including) 90 degrees"],
  [(o) => o.backing === undefined || o.backing >= 0, "bevelGear needs a non-negative backing"],
];

/** Throws when an option is outside what the port builds, naming it. */
function assertBevelBasics(o: any): void {
  const broken = BEVEL_RULES.find(([ok]) => !ok(o));
  if (broken) throw new Error(broken[1]);
}

/** The pitch angle, refusing the crown and internal gears the port does not build. */
function checkedPitchAngle(o: any, shaftAngle: number): number {
  const pitchAngle = pitchAngleOf(o.teeth, o.mateTeeth, shaftAngle);
  if (pitchAngle >= 90) {
    throw new Error("bevelGear: this gear's pitch angle is " + pitchAngle.toFixed(1) + " degrees - a crown or " +
      "internal bevel gear, which is not supported; use more teeth on the mate or a smaller shaftAngle");
  }
  return pitchAngle;
}

/** The face width: as given, or BOSL2's min(coneDistance / 3, 10 x module). */
function faceWidthOf(o: any, coneDistance: number): number {
  const faceWidth = o.faceWidth ?? Math.min(coneDistance / 3, 10 * o.module);
  if (!(faceWidth > 0 && faceWidth < coneDistance)) {
    throw new Error("bevelGear needs a faceWidth between 0 and the cone distance (" + coneDistance.toFixed(2) + " mm)");
  }
  return faceWidth;
}

/** Validates the options and fills BOSL2's defaults. */
export function resolveBevelSpec(o: any): BevelSpec {
  assertBevelBasics(o);
  const shaftAngle = o.shaftAngle ?? 90;
  const pitchAngle = checkedPitchAngle(o, shaftAngle);
  const pitchRadius = (o.module * o.teeth) / 2;
  const coneDistance = pitchRadius / Math.sin(pitchAngle * DEG);
  const spiral = o.spiral ?? 0;
  return {
    module: o.module, teeth: o.teeth, mateTeeth: o.mateTeeth, shaftAngle,
    pressureAngle: o.pressureAngle ?? 20, spiral, rightHanded: Boolean(o.rightHanded),
    // Straight teeth need no slicing along the face.
    slices: spiral === 0 ? 1 : Math.max(1, Math.round(o.slices ?? SPIRAL_SLICES)),
    bore: o.bore ?? 0, pitchAngle, pitchRadius, coneDistance, faceWidth: faceWidthOf(o, coneDistance),
    ...(o.backing !== undefined ? { backing: o.backing } : {}),
  };
}

/** BOSL2 law_of_cosines(a, b, c): the angle opposite c, in degrees. */
function angleOpposite(a: number, b: number, c: number): number {
  return Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b)))) / DEG;
}

/**
 * The cutter arc's samples, outer end first: each slice's cone distance and turn.
 * @remarks A straight gear uses BOSL2's cutter_radius=0, a radius of
 *   100 x faceWidth, so the arc is a straight line up the cone and the turn is
 *   ~0; a spiral gear's turn grows along the face.
 */
function slicePlaces(s: BevelSpec): { u: number; turn: number }[] {
  const inner = s.coneDistance - s.faceWidth;
  const cutter = s.spiral === 0 ? s.faceWidth * 100 : (s.faceWidth * 2) / Math.cos(s.spiral * DEG);
  const mid = (inner + s.coneDistance) / 2;
  const c: [number, number] = [cutter * Math.cos((180 + s.spiral) * DEG), mid + cutter * Math.sin((180 + s.spiral) * DEG)];
  const cn = Math.hypot(c[0], c[1]);
  const ca = Math.atan2(c[1], c[0]) / DEG;
  const start = ca - (180 - angleOpposite(cutter, cn, s.coneDistance));
  const end = ca - (180 - angleOpposite(cutter, cn, inner));
  return Array.from({ length: s.slices + 1 }, (_v, k) => {
    const a = (start + ((end - start) * k) / s.slices) * DEG;
    const p = [c[0] + cutter * Math.cos(a), c[1] + cutter * Math.sin(a)];
    return { u: Math.hypot(p[0], p[1]) / s.coneDistance, turn: Math.atan2(p[1], p[0]) / DEG - 90 };
  });
}

/** One slice: every tooth, scaled to cone distance u, tilted onto the pitch cone and turned. */
function sliceRing(s: BevelSpec, tooth: number[][], u: number, turn: number): Vec3[] {
  const pa = s.pitchAngle * DEG;
  const lift = DEDENDUM * s.module * Math.sin(pa) + ((1 - u) * s.pitchRadius) / Math.tan(pa);
  const spin = (turn / Math.sin(pa)) * DEG;
  const ring: Vec3[] = [];
  for (let t = 0; t < s.teeth; t++) {
    const rot = spin + (2 * Math.PI * t) / s.teeth;
    for (const [px, py] of tooth) {
      const x = px * u;
      // BOSL2 back() is +Y: the tooth sits on the +Y side, pointing outward.
      const y = py * u * Math.cos(pa) + u * s.pitchRadius;
      const z = py * u * Math.sin(pa) + lift;
      // zrot(rot), then BOSL2's per-tooth xflip.
      ring.push([-(x * Math.cos(rot) - y * Math.sin(rot)), x * Math.sin(rot) + y * Math.cos(rot), z]);
    }
  }
  return ring;
}

/** Triangles across one end face: each tooth zipped from its two flanks, plus a fan of the roots to a centre. */
function endFaces(base: number, perTooth: number, teeth: number, centre: number): number[][] {
  const faces: number[][] = [];
  const total = perTooth * teeth;
  for (let i = 0; i < teeth; i++) {
    const o = base + i * perTooth;
    for (let j = 0; 2 * j + 2 < perTooth; j++) {
      faces.push([o + j, o + perTooth - 1 - j, o + perTooth - 2 - j]);
      if (j + 1 !== perTooth - 2 - j) faces.push([o + j, o + perTooth - 2 - j, o + j + 1]);
    }
    const first = base + i * perTooth;
    const last = first + perTooth - 1;
    const next = base + ((i + 1) * perTooth) % total;
    faces.push([centre, last, first], [centre, next, last]);
  }
  return faces;
}

/** Quads between consecutive slices, wrapping round the ring. */
function sideFaces(rings: number, ringSize: number): number[][] {
  const faces: number[][] = [];
  for (let k = 0; k + 1 < rings; k++) {
    for (let i = 0; i < ringSize; i++) {
      const a = k * ringSize + i;
      const b = k * ringSize + ((i + 1) % ringSize);
      faces.push([a, b + ringSize, b], [a, a + ringSize, b + ringSize]);
    }
  }
  return faces;
}

/** The backing a gear gets by default: none when its centre is at least half a face width thick. */
function backingOf(s: BevelSpec, centreThickness: number): number {
  if (s.backing !== undefined) {
    if (!(centreThickness > 0 || s.backing > 0)) throw new Error("bevelGear: this gear needs backing > 0");
    return s.backing - Math.min(0, centreThickness);
  }
  return centreThickness > s.faceWidth / 2 ? 0 : s.faceWidth / 2 - centreThickness;
}

/**
 * The backing below the outer slice: each tooth root pair pushed down by
 * `backing`, continuing the cone, with its own floor (BOSL2's cone_backing).
 */
function backingFaces(s: BevelSpec, verts: Vec3[], perTooth: number, backing: number): number[][] {
  const shift = verts.length;
  const pull = -backing / Math.tan(s.pitchAngle * DEG);
  for (let i = 0; i < s.teeth; i++) {
    for (const v of [verts[i * perTooth], verts[(i + 1) * perTooth - 1]]) {
      const r = Math.hypot(v[0], v[1]) || 1;
      verts.push([v[0] + (pull * v[0]) / r, v[1] + (pull * v[1]) / r, v[2] - backing]);
    }
  }
  const floor = verts.length;
  verts.push([0, 0, verts[0][2] - backing]);
  const n = 2 * s.teeth;
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) faces.push([floor, shift + ((i + 1) % n), shift + i]);
  for (let i = 0; i < s.teeth; i++) {
    const last = (i + 1) * perTooth - 1;
    const next = ((i + 1) % s.teeth) * perTooth;
    faces.push(
      [shift + 2 * i, shift + 2 * i + 1, last],
      [shift + 2 * i + 1, shift + 2 * ((i + 1) % s.teeth), next],
      [last, i * perTooth, shift + 2 * i],
      [next, last, shift + 2 * i + 1],
    );
  }
  return faces;
}

/** Signed volume of a closed triangle soup; negative means it is wound inside out. */
function signedVolume(verts: Vec3[], faces: number[][]): number {
  let v = 0;
  for (const [a, b, c] of faces) {
    const [p, q, r] = [verts[a], verts[b], verts[c]];
    v += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  return v / 6;
}

/**
 * The gear's vertices and triangles, positioned as BOSL2's "pitchbase"
 * anchor: the base of the pitch cone on z = 0, axis on Z, teeth toward +Z.
 */
export function bevelGearMesh(s: BevelSpec, tooth: number[][]): { verts: Vec3[]; faces: number[][] } {
  const perTooth = tooth.length;
  const ringSize = perTooth * s.teeth;
  const places = slicePlaces(s);
  const verts: Vec3[] = places.flatMap(({ u, turn }) => sliceRing(s, tooth, u, turn));
  const topBase = (places.length - 1) * ringSize;
  const botz = verts[0][2];
  const topz = verts[topBase][2];
  const backing = backingOf(s, topz - botz);
  const top = verts.length;
  verts.push([0, 0, topz]);
  const faces = [...sideFaces(places.length, ringSize), ...endFaces(topBase, perTooth, s.teeth, top)];
  if (backing === 0) {
    const bottom = verts.length;
    verts.push([0, 0, botz]);
    faces.push(...endFaces(0, perTooth, s.teeth, bottom).map((f) => [...f].reverse()));
  } else {
    faces.push(...endFaces(0, perTooth, s.teeth, -1).filter((f) => !f.includes(-1)).map((f) => [...f].reverse()));
    faces.push(...backingFaces(s, verts, perTooth, backing).map((f) => [...f].reverse()));
  }
  // BOSL2 builds a left-handed gear by mirroring the right-handed one.
  const hand = s.rightHanded ? 1 : -1;
  // BOSL2's "pitchbase" anchor sits pitchoff above the outer slice's root.
  const drop = botz + DEDENDUM * s.module * Math.sin(s.pitchAngle * DEG);
  const placed: Vec3[] = verts.map(([x, y, z]) => [hand * x, y, z - drop]);
  const oriented = signedVolume(placed, faces) < 0 ? faces.map((f) => [...f].reverse()) : faces;
  return { verts: placed, faces: oriented };
}

/**
 * How far above the pitch base the pitch-cone apex is, in millimetres.
 * @remarks pitchRadius / tan(pitchAngle) - BOSL2's "apex" anchor measured
 *   from its "pitchbase". Two bevel gears mesh with their apexes at one point.
 */
export function bevelApexHeight(opts: any): number {
  const s = resolveBevelSpec(opts ?? {});
  return s.pitchRadius / Math.tan(s.pitchAngle * DEG);
}

/** The bevel gear as a Manifold solid, minus its bore. */
export function bevelGear(module: ManifoldModule, opts: any, toothFor: BevelTooth): any {
  const { Manifold, Mesh } = module as any;
  const s = resolveBevelSpec(opts ?? {});
  const { verts, faces } = bevelGearMesh(s, toothFor(s.module, s.teeth, s.pressureAngle));
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(verts.flat()),
    triVerts: Uint32Array.from(faces.flat()),
  });
  mesh.merge();
  const solid = new Manifold(mesh);
  if (!(s.bore > 0)) return solid;
  const box = solid.boundingBox();
  const h = box.max[2] - box.min[2] + 2;
  return solid.subtract(
    Manifold.cylinder(h, s.bore / 2, s.bore / 2, 0, true).translate([0, 0, (box.max[2] + box.min[2]) / 2]),
  );
}
