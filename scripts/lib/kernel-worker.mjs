/**
 * A CAD kernel that builds and draws in a worker thread, with a wall-clock limit.
 * @remarks The harness kernel is synchronous and in-process, so one part that
 *   never finishes freezes every pool slot: a full MUSE run sat at 92% CPU and
 *   4.3 GB for over two hours on a single case. The browser has the limit this
 *   copies - it terminates a render after 90 s (CAD_RENDER_TIMEOUT in
 *   frontend/src/js/services/cad-render.ts) - so a part that takes longer is
 *   what a user would see fail, and the benchmark now records it the same way.
 *   One fresh worker per call: Manifold loads in well under a second, and a
 *   terminated worker can never leak state into the next part.
 */
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

/** The browser's render limit (frontend/src/js/services/cad-render.ts DEFAULT_TIMEOUT_MS). */
export const RENDER_TIMEOUT_MS = 90000;

/** A build or drawing ran past the render limit and was terminated. */
export class RenderTimeout extends Error {
  /** @param {string} what @param {number} ms */
  constructor(what, ms) {
    super(what + " timed out after " + ms + " ms - the browser would have stopped it too");
    this.name = "RenderTimeout";
  }
}

/**
 * @param {{ timeoutMs?: number, workerUrl?: URL }} [opts] workerUrl is for tests.
 * @returns {{ run: (design: any) => Promise<{ mesh: any, stats: any }>,
 *   draw: (mesh: any, files: { svg: string, png: string, title: string }) => Promise<void> }}
 */
export function createWorkerKernel(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? RENDER_TIMEOUT_MS;
  const url = opts.workerUrl ?? new URL("./kernel-worker-entry.mjs", import.meta.url);
  /** @param {string} what @param {any} job @returns {Promise<any>} */
  const call = (what, job) => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(url));
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new RenderTimeout(what, timeoutMs));
    }, timeoutMs);
    /** @param {() => void} settle */
    const finish = (settle) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    worker.on("message", (/** @type {any} */ data) => finish(() => (data.ok ? resolve(data) : reject(new Error(data.error)))));
    worker.on("error", (/** @type {Error} */ e) => finish(() => reject(new Error(e.message || "kernel worker failed"))));
    worker.postMessage(job);
  });
  return {
    async run(design) {
      return (await call("build", { kind: "run", design })).run;
    },
    async draw(mesh, files) {
      await call("drawing", { kind: "draw", mesh, files, date: new Date().toISOString().slice(0, 10) });
    },
  };
}
