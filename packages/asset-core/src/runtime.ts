import type { ArbeskCoreConfig, ArbeskRuntime } from "./types.ts";
import { defaultKernels } from "./kernels/index.ts";
import { inlineExecutor } from "./executor/inline.ts";
import { memoryStorage } from "./storage/memory.ts";
import { _setRuntime, getRuntime } from "./runtime-state.ts";

export { getRuntime };

/** Sets the process-wide runtime. */
export function initRuntime(config: ArbeskCoreConfig): ArbeskRuntime {
  const runtime: ArbeskRuntime = {
    ipfsRead: config.ipfsRead,
    ipfsWrite: config.ipfsWrite,
    credentials: config.credentials ?? null,
    chain: config.chain ?? null,
    collection: config.collection ?? null,
    hash: config.hash ?? null,
    storage: config.storage ?? memoryStorage(),
    executor: config.executor ?? inlineExecutor,
    kernels: { ...defaultKernels, ...(config.kernels ?? {}) },
  };
  _setRuntime(runtime);
  return runtime;
}

export function _resetRuntimeForTesting(): void {
  _setRuntime(null);
}
