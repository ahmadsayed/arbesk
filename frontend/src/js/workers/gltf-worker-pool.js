/**
 * Arbesk glTF Web Worker Pool
 *
 * Thin wrapper around workerpool for offloading glTF operations to a small
 * pool of module Web Workers. If module workers are unsupported or fail to
 * load, the pool reports itself as unavailable and callers fall back to
 * main-thread implementations.
 */

import workerpool from "../vendor/workerpool-10.0.2.mjs";

const WORKER_SCRIPT = new URL("./gltf-worker.js", import.meta.url);
const MAX_WORKERS = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));

let pool = null;
let available = null;
let terminating = false;

function createPool() {
  terminating = false;
  return workerpool.pool(WORKER_SCRIPT, {
    workerType: "web",
    maxWorkers: MAX_WORKERS,
    minWorkers: 0,
    workerOpts: { type: "module" },
  });
}

export function getGlTFWorkerPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function isWorkerPoolAvailable() {
  if (available !== null) return available;
  if (typeof Worker === "undefined") {
    available = false;
    return false;
  }

  try {
    const p = getGlTFWorkerPool();
    await p.exec("ping", [], { timeout: 5000 });
    available = true;
    return true;
  } catch (error) {
    console.warn("[WORKER-POOL] module workers not available, falling back to main thread:", error.message);
    available = false;
    if (pool) {
      terminating = true;
      pool.terminate().catch(() => {});
      pool = null;
    }
    return false;
  }
}

export function terminateGlTFWorkerPool() {
  if (pool) {
    terminating = true;
    pool.terminate().catch(() => {});
    pool = null;
  }
  available = null;
}
