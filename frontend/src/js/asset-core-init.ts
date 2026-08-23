/**
 * Frontend composition root for asset-core.
 *
 * One call at Studio boot installs the process-wide runtime with every
 * browser port and returns the shared SDK facade. Service modules (download,
 * upload, editors) use `initAssetCoreBrowser()` instead of constructing their
 * own core so custom kernels/ports stay consistent app-wide.
 */

import { createArbeskCore, type ArbeskCore } from "./asset-core/facade.ts";
import { createBrowserIpfsPorts } from "./ipfs/asset-core-adapter.ts";
import { createBrowserPlatformPorts } from "./blockchain/asset-core-adapter.ts";
import { createWorkerExecutor } from "./workers/worker-executor.ts";
import { getUploadCredentials } from "./services/api.ts";

let core: ArbeskCore | null = null;

/** Single frontend entry point — call once at Studio boot. */
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
