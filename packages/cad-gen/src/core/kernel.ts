/** Kernel port: design document to mesh plus stats. The host injects the Manifold module. */
import type { CadDesign, CadMesh, CadStats, ManifoldModule } from "../types.ts";
import { CadKernelError } from "../errors.ts";
import { PRELUDE_NAMES, buildPrelude } from "./prelude.ts";
import type { PreludeHelpers, PreludeOptions } from "./prelude.ts";

export interface KernelRunResult {
  /** Every part's mesh side by side, never unioned. */
  mesh: CadMesh;
  /** One mesh per returned part, in script order. */
  parts: CadMesh[];
  stats: CadStats;
}

export interface CadKernel {
  run(design: CadDesign): KernelRunResult;
}

interface ManifoldMeshData {
  vertProperties: ArrayLike<number>;
  numProp: number;
  triVerts: ArrayLike<number>;
}

interface ManifoldBox {
  min: [number, number, number];
  max: [number, number, number];
}

function parameterValues(design: CadDesign): Record<string, number | string> {
  const values: Record<string, number | string> = {};
  for (const [name, p] of Object.entries(design.parameters)) values[name] = p.value;
  return values;
}

function compileScript(code: string, names: string[]): (...args: unknown[]) => unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function("PARAMETERS", "P", "M", ...names, code) as never;
  } catch (e) {
    throw new CadKernelError("script does not parse: " + (e as Error).message);
  }
}

function callScript(
  fn: (...args: unknown[]) => unknown,
  values: Record<string, number | string>,
  module: ManifoldModule,
  helpers: PreludeHelpers,
  names: string[],
): any {
  try {
    return fn(values, values, module.Manifold, ...names.map((n) => helpers[n]));
  } catch (e) {
    throw new CadKernelError("script threw: " + (e as Error).message);
  }
}

/**
 * `instanceof`, not duck typing: the untrusted script holds `M` and could
 * return an object that mimics the methods the gates read.
 */
function assertManifold(result: any, module: ManifoldModule, label = ""): any {
  if (!(result instanceof module.Manifold)) {
    throw new CadKernelError(label ? label + "did not return a Manifold" : "script did not return a Manifold");
  }
  const status = result.status();
  if (status !== "NoError") {
    throw new CadKernelError(label + "kernel status: " + String(status));
  }
  return result;
}

/** A bound for the browser worker, not a design rule. */
export const MAX_PARTS = 64;

function partsOf(result: unknown, module: ManifoldModule): { solids: any[]; array: boolean } {
  if (!Array.isArray(result)) return { solids: [assertManifold(result, module)], array: false };
  if (result.length > MAX_PARTS) {
    throw new CadKernelError("script returned " + result.length + " parts; at most " + MAX_PARTS + " are allowed");
  }
  return { solids: result.map((r, i) => assertManifold(r, module, "part " + (i + 1) + ": ")), array: true };
}

/** Concatenation, never a union: touching parts stay separate. */
export function concatMeshes(meshes: CadMesh[]): CadMesh {
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const indices = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
  let p = 0;
  let i = 0;
  for (const m of meshes) {
    const base = p / 3;
    positions.set(m.positions, p);
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + base;
    p += m.positions.length;
    i += m.indices.length;
  }
  return { positions, indices };
}

export function meshFrom(raw: ManifoldMeshData): CadMesh {
  const vertCount = raw.vertProperties.length / raw.numProp;
  const positions = new Float32Array(vertCount * 3);
  for (let v = 0; v < vertCount; v++) {
    positions[v * 3 + 0] = raw.vertProperties[v * raw.numProp + 0];
    positions[v * 3 + 1] = raw.vertProperties[v * raw.numProp + 1];
    positions[v * 3 + 2] = raw.vertProperties[v * raw.numProp + 2];
  }
  return { positions, indices: new Uint32Array(raw.triVerts) };
}

const EMPTY_BBOX: [number, number, number] = [0, 0, 0];

/**
 * Manifold reports an empty solid's bounds as +/-Infinity, which JSON turns
 * into null; zeros keep the payload valid so the nonempty gate can explain it.
 */
function boundsOf(result: any, triangles: number): ManifoldBox {
  if (triangles > 0) return result.boundingBox() as ManifoldBox;
  return { min: EMPTY_BBOX, max: EMPTY_BBOX };
}

function statsFrom(result: any, helpers: PreludeHelpers): CadStats {
  const triangles = result.numTri();
  const box = boundsOf(result, triangles);
  return {
    triangles,
    vertices: result.numVert(),
    volumeMm3: result.volume(),
    bboxMm: { min: [...box.min], max: [...box.max] },
    ...(helpers.lastFilletMode ? { filletMode: helpers.lastFilletMode } : {}),
    ...(helpers.lastFilletQuality ? { filletQuality: helpers.lastFilletQuality } : {}),
    ...bodiesOf(result),
  };
}

/** Below this (a 0.1mm cube) a decomposed body is a numerical flake, not a part. */
export const DEGENERATE_BODY_MM3 = 1e-3;

function isDegenerate(body: any): boolean {
  return Math.abs(body.volume()) < DEGENERATE_BODY_MM3;
}

function withoutFlakes(module: ManifoldModule, result: any): { solid: any; dropped: number } {
  if (typeof result.decompose !== "function") return { solid: result, dropped: 0 };
  const parts: any[] = result.decompose();
  const kept = parts.filter((p) => !isDegenerate(p));
  const dropped = parts.length - kept.length;
  if (dropped === 0 || kept.length === 0) return { solid: result, dropped: 0 };
  return { solid: (module as any).Manifold.compose(kept), dropped };
}

/** Bodies listed in a repair message. */
const MAX_BODY_BOXES = 8;

type Component = { volume: number; box: ManifoldBox; part?: number };

/** A cut that never reaches a face leaves a negative-volume component: a void, not a body. */
function componentsOf(solid: any, part?: number): { bodies: Component[]; voids: Component[] } {
  const all: Component[] = solid.decompose().filter((p: any) => !isDegenerate(p))
    .map((p: any) => ({ volume: p.volume() as number, box: p.boundingBox() as ManifoldBox, ...(part ? { part } : {}) }));
  return { bodies: all.filter((c) => c.volume > 0), voids: all.filter((c) => c.volume < 0) };
}

/** Largest first by magnitude, capped. */
function listed(components: Component[]): NonNullable<CadStats["bodies"]> {
  const boxes = [...components]
    .sort((a, b) => Math.abs(b.volume) - Math.abs(a.volume))
    .slice(0, MAX_BODY_BOXES)
    .map(({ box, part }) => ({
      min: [...box.min] as [number, number, number], max: [...box.max] as [number, number, number],
      ...(part ? { part } : {}),
    }));
  return { count: components.length, boxes };
}

function bodiesOf(result: any): Pick<CadStats, "bodies" | "voids"> {
  if (typeof result.decompose !== "function") return {};
  const { bodies, voids } = componentsOf(result);
  return { bodies: listed(bodies), ...(voids.length > 0 ? { voids: listed(voids) } : {}) };
}

type Box = { min: [number, number, number]; max: [number, number, number] };

function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) return { min: [...EMPTY_BBOX], max: [...EMPTY_BBOX] };
  const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  return { min: min as Box["min"], max: max as Box["max"] };
}

function partBodiesOf(solids: any[]): Pick<CadStats, "bodies" | "voids"> & { bodyCounts: number[] } {
  if (solids.length === 0 || typeof solids[0].decompose !== "function") {
    return { bodyCounts: solids.map(() => 1) };
  }
  const tagged = solids.map((s, i) => componentsOf(s, i + 1));
  const voids = tagged.flatMap((t) => t.voids);
  return {
    bodies: listed(tagged.flatMap((t) => t.bodies)),
    ...(voids.length > 0 ? { voids: listed(voids) } : {}),
    bodyCounts: tagged.map((t) => t.bodies.length),
  };
}

const MAX_OVERLAPS = 8;

/** Boxes that only touch do not meet. */
function boxesMeet(a: Box, b: Box): boolean {
  return [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
}

/** Recorded, never failed: a pin in its hole overlaps by design. */
function overlapsOf(solids: any[], boxes: Box[]): Pick<NonNullable<CadStats["parts"]>, "overlaps" | "overlapCount"> {
  const found: { a: number; b: number; volumeMm3: number }[] = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j])) continue;
      const volumeMm3 = solids[i].intersect(solids[j]).volume();
      if (volumeMm3 > DEGENERATE_BODY_MM3) found.push({ a: i + 1, b: j + 1, volumeMm3 });
    }
  }
  if (found.length === 0) return {};
  found.sort((x, y) => y.volumeMm3 - x.volumeMm3);
  return { overlaps: found.slice(0, MAX_OVERLAPS), overlapCount: found.length };
}

function arrayStatsFrom(solids: any[], helpers: PreludeHelpers): CadStats {
  const boxes: Box[] = solids.map((s) => {
    const b = boundsOf(s, s.numTri());
    return { min: [...b.min] as Box["min"], max: [...b.max] as Box["max"] };
  });
  const { bodies, voids, bodyCounts } = partBodiesOf(solids);
  return {
    triangles: solids.reduce((n, s) => n + s.numTri(), 0),
    vertices: solids.reduce((n, s) => n + s.numVert(), 0),
    volumeMm3: solids.reduce((n, s) => n + s.volume(), 0),
    bboxMm: unionBox(boxes.filter((_b, i) => solids[i].numTri() > 0)),
    ...(helpers.lastFilletMode ? { filletMode: helpers.lastFilletMode } : {}),
    ...(helpers.lastFilletQuality ? { filletQuality: helpers.lastFilletQuality } : {}),
    ...(bodies ? { bodies } : {}),
    ...(voids ? { voids } : {}),
    parts: { count: solids.length, array: true, boxes, bodyCounts, ...overlapsOf(solids, boxes) },
  };
}

function withColor(mesh: CadMesh, color: string | undefined): CadMesh {
  return color ? { ...mesh, color } : mesh;
}

export function createCadKernel(
  module: ManifoldModule,
  options: PreludeOptions = {},
): CadKernel {
  const names = [...PRELUDE_NAMES];

  return {
    run(design: CadDesign): KernelRunResult {
      const colorTags = new WeakMap<object, string>();
      const helpers = buildPrelude(module, { ...options, colorTags });
      const fn = compileScript(design.code, names);
      const { solids: raw, array } = partsOf(
        callScript(fn, parameterValues(design), module, helpers, names),
        module,
      );
      // Read before withoutFlakes, which may return a new, untagged instance.
      const colors = raw.map((s) => colorTags.get(s));
      if (!array) {
        const { solid: result, dropped } = withoutFlakes(module, raw[0]);
        const stats = statsFrom(result, helpers);
        const mesh = withColor(meshFrom(result.getMesh()), colors[0]);
        const parts = {
          count: 1, array: false, boxes: [stats.bboxMm], bodyCounts: [stats.bodies?.count ?? 1],
        };
        return {
          mesh,
          parts: [mesh],
          stats: { ...stats, ...(dropped > 0 ? { degenerateBodiesDropped: dropped } : {}), parts },
        };
      }
      const cleaned = raw.map((s, i) => ({ ...withoutFlakes(module, s), color: colors[i] }));
      const kept = cleaned.filter((c) => !isDegenerate(c.solid));
      const solids = kept.map((c) => c.solid);
      const dropped = cleaned.reduce((n, c) => n + c.dropped, 0) + (cleaned.length - solids.length);
      const parts = kept.map((c) => withColor(meshFrom(c.solid.getMesh()), c.color));
      const stats = arrayStatsFrom(solids, helpers);
      return {
        mesh: concatMeshes(parts),
        parts,
        stats: dropped > 0 ? { ...stats, degenerateBodiesDropped: dropped } : stats,
      };
    },
  };
}
