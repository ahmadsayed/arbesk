/**
 * Frontend composition root for asset-core.
 * @remarks One boot call installs the process-wide runtime with every browser
 *   port; reusing it keeps custom kernels/ports consistent app-wide.
 */

import { createArbeskCore, type ArbeskCore } from "@arbesk/asset-core/facade.js";
import { createBrowserIpfsPorts } from "./ipfs/asset-core-adapter.ts";
import { createBrowserPlatformPorts } from "./blockchain/asset-core-adapter.ts";
import { createWorkerExecutor } from "./workers/worker-executor.ts";
import { getUploadCredentials } from "./services/api.ts";

let core: ArbeskCore | null = null;

/** @remarks Call once at Studio boot. */
export function initAssetCoreBrowser(): ArbeskCore {
  if (core) return core;
  const { read, write } = createBrowserIpfsPorts();
  const { hash, storage, chain } = createBrowserPlatformPorts();
  core = createArbeskCore({
    ipfsRead: read,
    ipfsWrite: write,
    credentials: { getUploadCredentials },
    hash,
    storage,
    chain,
    executor: createWorkerExecutor(),
  });
  return core;
}
