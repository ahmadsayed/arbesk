/**
 * Main-thread wrapper around the CAD render worker.
 * @remarks The worker is the sandbox boundary (it evals model-written code):
 *   it holds no session token and does no network I/O. The 90 s default cap
 *   bounds kernel runaways — the server-side kernel limits went away when the
 *   kernel moved to the client.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { CadRenderError } from "../workers/cad-render-core.ts";

export { CadRenderError };

export interface CadRenderResult {
  bytes: Uint8Array;
  summary: string;
  stats: unknown;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const WORKER_URL = "/workers/cad-worker.js";

export function renderCadDesignInWorker(
  design: CadDesign,
  runtime: { preludeVersion?: string },
  opts: { timeoutMs?: number } = {},
): Promise<CadRenderResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { type: "module" });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new CadRenderError("CAD_RENDER_TIMEOUT", "CAD rendering timed out — try a simpler request."))),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "ok") {
        finish(() => resolve({ bytes: data.bytes, summary: data.summary, stats: data.stats }));
      } else if (data?.type === "error") {
        finish(() => reject(new CadRenderError(data.code ?? "CAD_KERNEL_FAILED", data.message ?? "CAD rendering failed.")));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(new CadRenderError("CAD_KERNEL_FAILED", event.message || "CAD worker crashed.")));
    };
    worker.postMessage({ type: "render", design, runtime });
  });
}
