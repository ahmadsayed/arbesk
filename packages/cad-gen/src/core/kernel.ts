/**
 * Kernel port: design document becomes mesh plus stats.
 * @remarks The Manifold module is injected by the host (Emscripten glue in the
 *   validation child, bundled web build in the browser worker), so core/ owns
 *   no loader and no WASM path resolution.
 */
import type { CadDesign, CadMesh, CadStats, ManifoldModule } from "../types.ts";
import { CadKernelError } from "../errors.ts";
import { PRELUDE_NAMES, buildPrelude } from "./prelude.ts";
import type { PreludeHelpers, PreludeOptions } from "./prelude.ts";

export interface KernelRunResult {
  /** Every part's mesh laid side by side (never unioned). */
  mesh: CadMesh;
  /** One mesh per returned part, in the script's order. */
  parts: CadMesh[];
  stats: CadStats;
}

export interface CadKernel {
  run(design: CadDesign): KernelRunResult;
}

/** The interleaved property buffers Manifold hands back. */
interface ManifoldMeshData {
  vertProperties: ArrayLike<number>;
  numProp: number;
  triVerts: ArrayLike<number>;
}

/** The axis-aligned bounds Manifold reports. */
interface ManifoldBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** Builds the parameter name -> value map the script sees as PARAMETERS/P. */
function parameterValues(design: CadDesign): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [name, p] of Object.entries(design.parameters)) values[name] = p.value;
  return values;
}

/**
 * Compiles a script body into a callable bound to the injected surface.
 * @throws CadKernelError when the body does not parse.
 */
function compileScript(code: string, names: string[]): (...args: unknown[]) => unknown {
  try {
    // The script is the product; the process boundary is the sandbox.
    // eslint-disable-next-line no-new-func
    return new Function("PARAMETERS", "P", "M", ...names, code) as never;
  } catch (e) {
    throw new CadKernelError("script does not parse: " + (e as Error).message);
  }
}

/**
 * Calls a compiled script with the injected surface.
 * @throws CadKernelError when the script throws.
 */
function callScript(
  fn: (...args: unknown[]) => unknown,
  values: Record<string, number>,
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
 * Asserts a script handed back a usable, error-free Manifold.
 * @remarks Identity, not duck typing. The script is the untrusted party and it
 *   holds `M`, so it can return a hand-rolled object that mimics every method
 *   the stat gates read — and every gate would then be reporting numbers the
 *   script itself chose. `instanceof` against the injected module is the one
 *   check the script cannot forge.
 * @param label Prefix naming the part, for an array return ("part 2: ").
 * @throws CadKernelError when it did not.
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

/** Most parts a script may return: a bound for the browser worker, not a design rule. */
export const MAX_PARTS = 64;

/**
 * The script's return as checked parts, and whether it was an array.
 * @throws CadKernelError naming the 1-based part that is not a usable Manifold,
 *   or when there are more than MAX_PARTS.
 */
function partsOf(result: unknown, module: ManifoldModule): { solids: any[]; array: boolean } {
  if (!Array.isArray(result)) return { solids: [assertManifold(result, module)], array: false };
  if (result.length > MAX_PARTS) {
    throw new CadKernelError("script returned " + result.length + " parts; at most " + MAX_PARTS + " are allowed");
  }
  return { solids: result.map((r, i) => assertManifold(r, module, "part " + (i + 1) + ": ")), array: true };
}

/**
 * Lays meshes side by side in one mesh, offsetting each one's indices.
 * @remarks Concatenation, never a union: touching parts stay separate and
 *   overlapping ones cannot produce a non-manifold result.
 */
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

/** De-interleaves Manifold's property buffer into a renderer-neutral mesh. */
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

/** The bounds reported for a solid with no geometry. */
const EMPTY_BBOX: [number, number, number] = [0, 0, 0];

/**
 * The axis-aligned bounds of a solid, with the empty case made concrete.
 * @remarks An empty manifold has no extent, so Manifold reports
 *   min = [+Infinity, +Infinity, +Infinity] and max = [-Infinity, ...].
 *   JSON.stringify turns every one of those into null, so the payload failed
 *   the parent's shape check and an empty result — a *script* fault the
 *   nonempty gate exists to explain — came back as "kernel host produced an
 *   invalid result". A message that names no cause and reads like a server
 *   problem gives the repair loop nothing to act on.
 *   Zeros are the honest bound for nothing, and they keep the payload the
 *   three finite numbers CadStats promises. This normalises the *empty* case
 *   only: the shape check downstream is untouched, so a forged or malformed
 *   payload is still rejected fail-closed.
 */
function boundsOf(result: any, triangles: number): ManifoldBox {
  if (triangles > 0) return result.boundingBox() as ManifoldBox;
  return { min: EMPTY_BBOX, max: EMPTY_BBOX };
}

/** Collects the geometry facts the validation gates read. */
function statsFrom(result: any, helpers: PreludeHelpers): CadStats {
  // The module is untyped past the port, so the kernel's Box shape is
  // restated here (and only here) to keep the tuple type on bboxMm.
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

/**
 * The volume below which a decomposed body is a numerical flake, not a part.
 * @remarks Measured live: a cable clip's filletEdges opening left a body of
 *   -5e-14 mm3 and 4 triangles where a channel nearly broke through the top
 *   face. The connected gate counted it as a loose piece and sent the model -
 *   twice - to "extend it into the solid", which no edit to the design can do.
 *   0.001 mm3 is a 0.1mm cube: far below any feature a printer can make.
 */
export const DEGENERATE_BODY_MM3 = 1e-3;

/** Whether a decomposed body is a zero-volume flake. */
function isDegenerate(body: any): boolean {
  return Math.abs(body.volume()) < DEGENERATE_BODY_MM3;
}

/**
 * The solid with any zero-volume flakes removed, and how many there were.
 * @remarks So the delivered mesh is clean as well as the body count honest.
 */
function withoutFlakes(module: ManifoldModule, result: any): { solid: any; dropped: number } {
  if (typeof result.decompose !== "function") return { solid: result, dropped: 0 };
  const parts: any[] = result.decompose();
  const kept = parts.filter((p) => !isDegenerate(p));
  const dropped = parts.length - kept.length;
  if (dropped === 0 || kept.length === 0) return { solid: result, dropped: 0 };
  return { solid: (module as any).Manifold.compose(kept), dropped };
}

/** Bodies listed in a repair message; past this the count says enough. */
const MAX_BODY_BOXES = 8;

/** The solid's separate bodies, largest first; nothing when the host cannot decompose. */
function bodiesOf(result: any): Pick<CadStats, "bodies"> {
  if (typeof result.decompose !== "function") return {};
  const parts: any[] = result.decompose().filter((p: any) => !isDegenerate(p));
  const boxes = parts
    .map((p) => ({ volume: p.volume(), box: p.boundingBox() as ManifoldBox }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MAX_BODY_BOXES)
    .map(({ box }) => ({ min: [...box.min] as [number, number, number], max: [...box.max] as [number, number, number] }));
  return { bodies: { count: parts.length, boxes } };
}

type Box = { min: [number, number, number]; max: [number, number, number] };

/** The bounds of every non-empty box, or the empty-solid zeros when there are none. */
function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) return { min: [...EMPTY_BBOX], max: [...EMPTY_BBOX] };
  const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  return { min: min as Box["min"], max: max as Box["max"] };
}

/** Every part's bodies, tagged with their 1-based part, plus each part's body count. */
function partBodiesOf(solids: any[]): { bodies?: CadStats["bodies"]; bodyCounts: number[] } {
  if (solids.length === 0 || typeof solids[0].decompose !== "function") {
    return { bodyCounts: solids.map(() => 1) };
  }
  const tagged = solids.map((s, i) => s.decompose().filter((p: any) => !isDegenerate(p))
    .map((p: any) => ({ volume: p.volume() as number, box: p.boundingBox() as ManifoldBox, part: i + 1 })));
  const all = tagged.flat().sort((a: { volume: number }, b: { volume: number }) => b.volume - a.volume);
  return {
    bodies: {
      count: all.length,
      boxes: all.slice(0, MAX_BODY_BOXES).map(({ box, part }: { box: ManifoldBox; part: number }) => ({
        min: [...box.min] as Box["min"], max: [...box.max] as Box["max"], part,
      })),
    },
    bodyCounts: tagged.map((t) => t.length),
  };
}

/** Stats for an array return: totals over the parts, plus per-part facts. */
function arrayStatsFrom(solids: any[], helpers: PreludeHelpers): CadStats {
  const boxes: Box[] = solids.map((s) => {
    const b = boundsOf(s, s.numTri());
    return { min: [...b.min] as Box["min"], max: [...b.max] as Box["max"] };
  });
  const { bodies, bodyCounts } = partBodiesOf(solids);
  return {
    triangles: solids.reduce((n, s) => n + s.numTri(), 0),
    vertices: solids.reduce((n, s) => n + s.numVert(), 0),
    volumeMm3: solids.reduce((n, s) => n + s.volume(), 0),
    bboxMm: unionBox(boxes.filter((_b, i) => solids[i].numTri() > 0)),
    ...(helpers.lastFilletMode ? { filletMode: helpers.lastFilletMode } : {}),
    ...(helpers.lastFilletQuality ? { filletQuality: helpers.lastFilletQuality } : {}),
    ...(bodies ? { bodies } : {}),
    parts: { count: solids.length, array: true, boxes, bodyCounts },
  };
}

/**
 * Builds a kernel bound to a loaded Manifold module.
 * @throws CadKernelError when the script is malformed, throws, or does not
 *   return a valid Manifold.
 */
export function createCadKernel(
  module: ManifoldModule,
  options: PreludeOptions = {},
): CadKernel {
  const names = [...PRELUDE_NAMES];

  return {
    run(design: CadDesign): KernelRunResult {
      const helpers = buildPrelude(module, options);
      const fn = compileScript(design.code, names);
      const { solids: raw, array } = partsOf(
        callScript(fn, parameterValues(design), module, helpers, names),
        module,
      );
      if (!array) {
        const { solid: result, dropped } = withoutFlakes(module, raw[0]);
        const stats = statsFrom(result, helpers);
        const mesh = meshFrom(result.getMesh());
        const parts = {
          count: 1, array: false, boxes: [stats.bboxMm], bodyCounts: [stats.bodies?.count ?? 1],
        };
        return {
          mesh,
          parts: [mesh],
          stats: { ...stats, ...(dropped > 0 ? { degenerateBodiesDropped: dropped } : {}), parts },
        };
      }
      const cleaned = raw.map((s) => withoutFlakes(module, s));
      // A part that is nothing but a flake is not a part.
      const solids = cleaned.map((c) => c.solid).filter((s) => !isDegenerate(s));
      const dropped = cleaned.reduce((n, c) => n + c.dropped, 0) + (cleaned.length - solids.length);
      const parts = solids.map((s) => meshFrom(s.getMesh()));
      const stats = arrayStatsFrom(solids, helpers);
      return {
        mesh: concatMeshes(parts),
        parts,
        stats: dropped > 0 ? { ...stats, degenerateBodiesDropped: dropped } : stats,
      };
    },
  };
}
