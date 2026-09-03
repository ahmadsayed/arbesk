/**
 * Browser ExecutorPort backed by the glTF Web Worker pool.
 * @remarks Ops forward to the worker untouched, except compose ops, which get
 *   the browser's gateway base injected here — the worker fetches ipfs:// refs
 *   over HTTP itself, and asset-core deliberately does not know that base.
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
