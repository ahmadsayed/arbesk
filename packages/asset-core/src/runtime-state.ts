import type { ArbeskRuntime } from "./types.ts";

/**
 * Process-wide runtime holder — a leaf module (no asset-core imports beyond
 * types) so format pipelines (composer/decomposer/glb-parser/dedup) can read
 * the runtime without importing runtime.ts, whose initRuntime() pulls in the
 * executor + kernels. Importing runtime.ts from those pipelines created
 * import cycles (runtime → executor/inline → composer → runtime).
 */

let runtime: ArbeskRuntime | null = null;

/** @internal — called by initRuntime() only. */
export function _setRuntime(rt: ArbeskRuntime | null): void {
  runtime = rt;
}

export function getRuntime(): ArbeskRuntime {
  if (!runtime) {
    throw new Error("asset-core: not initialized — call createArbeskCore() (or initRuntime()) first");
  }
  return runtime;
}
