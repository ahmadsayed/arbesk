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
  mesh: CadMesh;
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
 * @throws CadKernelError when it did not.
 */
function assertManifold(result: any, module: ManifoldModule): any {
  if (!(result instanceof module.Manifold)) {
    throw new CadKernelError("script did not return a Manifold");
  }
  const status = result.status();
  if (status !== "NoError") {
    throw new CadKernelError("kernel status: " + String(status));
  }
  return result;
}

/** De-interleaves Manifold's property buffer into a renderer-neutral mesh. */
function meshFrom(raw: ManifoldMeshData): CadMesh {
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
      const result = assertManifold(
        callScript(fn, parameterValues(design), module, helpers, names),
        module,
      );

      return {
        mesh: meshFrom(result.getMesh()),
        stats: statsFrom(result, helpers),
      };
    },
  };
}
