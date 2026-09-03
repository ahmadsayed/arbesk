import type { ArbeskRuntime } from "./types.ts";

/**
 * Process-wide runtime holder.
 * @remarks A leaf module (no asset-core imports beyond types) so format
 *   pipelines can read the runtime without importing runtime.ts, which would
 *   create import cycles (runtime → executor/inline → composer → runtime).
 */

let runtime: ArbeskRuntime | null = null;

/** @internal */
export function _setRuntime(rt: ArbeskRuntime | null): void {
  runtime = rt;
}

export function getRuntime(): ArbeskRuntime {
  if (!runtime) {
    throw new Error("asset-core: not initialized — call createArbeskCore() (or initRuntime()) first");
  }
  return runtime;
}
