// @ts-nocheck
/**
 * Arbesk glTF Web Worker Pool
 *
 * Thin wrapper around workerpool for offloading glTF operations to a small
 * pool of module Web Workers. If module workers are unsupported or fail to
 * load, the pool reports itself as unavailable and callers fall back to
 * main-thread implementations.
 */

import workerpool from "../vendor/workerpool-10.0.2.mjs";

// workerpool's WorkerHandler checks `script || getDefaultWorker()` and, when
// the script is not a plain string, falls back to its embedded *classic*
// bootstrap worker (a blob URL created WITHOUT {type:"module"}). A classic
// worker cannot use top-level `import`/`export`, so gltf-worker.js - an ES
// module - fails to evaluate and only workerpool's built-in [run, methods]
// methods register. Passing a string (via .href) keeps workerpool on the
// direct-load path with the {type:"module"} workerOpts intact.
const WORKER_SCRIPT = new URL("./gltf-worker.js?v=4", import.meta.url).href;
const MAX_WORKERS = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));

let pool = null;
let available = null;

function createPool() {
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

const REQUIRED_WORKER_METHODS = ["compose", "decomposeGltf", "decomposeGlb", "bakeSourceColors"];

export async function isWorkerPoolAvailable() {
  if (available !== null) return available;
  if (typeof Worker === "undefined") {
    available = false;
    return false;
  }

  try {
    const p = getGlTFWorkerPool();
    // Use the built-in "methods" call rather than our custom "ping" so we can
    // inspect exactly what the worker registered. This is more robust than
    // pinging: if the worker module fails to evaluate, "methods" still exists
    // and returns the default ["run", "methods"].
    const methods = await p.exec("methods", [], { timeout: 5000 });
    const missing = REQUIRED_WORKER_METHODS.filter((m) => !methods.includes(m));
    if (missing.length === 0) {
      available = true;
      return true;
    }
    // If the worker registered an emergency initError reporter, retrieve the
    // original initialization failure so we can log something actionable.
    let initError = null;
    if (methods.includes("initError")) {
      try {
        initError = await p.exec("initError", [], { timeout: 5000 });
      } catch {
        // ignore - we'll still report the missing-methods fallback below
      }
    }
    console.warn(
      `[WORKER-POOL] worker missing methods [${missing.join(", ")}], registered: [${methods.join(", ")}]` +
        (initError ? `, initError: ${initError.message}` : "") +
        ", falling back to main thread"
    );
    if (initError?.stack) {
      console.warn(initError.stack);
    }
  } catch (error) {
    console.warn("[WORKER-POOL] module workers not available, falling back to main thread:", error.message);
  }

  available = false;
  if (pool) {
    pool.terminate().catch(() => {});
    pool = null;
  }
  return false;
}

export function terminateGlTFWorkerPool() {
  if (pool) {
    pool.terminate().catch(() => {});
    pool = null;
  }
  available = null;
}
