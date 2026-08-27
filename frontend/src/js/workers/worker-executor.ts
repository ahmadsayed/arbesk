/**
 * Browser ExecutorPort backed by the glTF Web Worker pool.
 *
 * Thin pass-through: ExecutorPort ops mirror the worker's registered methods
 * one-to-one, so exec() forwards op + payload untouched — with one exception:
 * compose ops need the browser's gateway base (the worker fetches ipfs://
 * refs over HTTP itself), which asset-core deliberately does not know about,
 * so it is injected here at the environment boundary.
 */
import type { ExecutorPort, ExecutorOp } from "@arbesk/asset-core/types.js";
import { getGlTFWorkerPool, isWorkerPoolAvailable } from "./gltf-worker-pool.ts";
import { gatewayBase } from "../ipfs/remote-ipfs.ts";

/** Browser ExecutorPort backed by the Web Worker pool. */
export function createWorkerExecutor(): ExecutorPort {
  return {
    available: () => isWorkerPoolAvailable(),
    exec: async <T>(op: ExecutorOp, args: unknown[]): Promise<T> => {
      let forwarded = args;
      if (op === "compose") {
        const [payload] = args;
        forwarded = [
          { ...(payload as Record<string, unknown>), gatewayBase: await gatewayBase() },
        ];
      }
      return getGlTFWorkerPool().exec(op, forwarded) as Promise<T>;
    },
  };
}
