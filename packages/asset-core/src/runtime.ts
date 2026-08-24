import type { ArbeskCoreConfig, ArbeskRuntime } from "./types.ts";
import { defaultKernels } from "./kernels/index.ts";
import { inlineExecutor } from "./executor/inline.ts";
import { memoryStorage } from "./storage/memory.ts";

let runtime: ArbeskRuntime | null = null;

/** Set the process-wide runtime. Called once per environment by createArbeskCore(). */
export function initRuntime(config: ArbeskCoreConfig): ArbeskRuntime {
  runtime = {
    ipfsRead: config.ipfsRead,
    ipfsWrite: config.ipfsWrite,
    credentials: config.credentials ?? null,
    chain: config.chain ?? null,
    hash: config.hash ?? null,
    storage: config.storage ?? memoryStorage(),
    executor: config.executor ?? inlineExecutor,
    kernels: { ...defaultKernels, ...(config.kernels ?? {}) },
  };
  return runtime;
}

export function getRuntime(): ArbeskRuntime {
  if (!runtime) {
    throw new Error("asset-core: not initialized — call createArbeskCore() (or initRuntime()) first");
  }
  return runtime;
}

export function _resetRuntimeForTesting(): void {
  runtime = null;
}
