/**
 * Worker side of createWorkerKernel: builds a design or draws a sheet.
 * @remarks Runs in its own thread so a part that computes forever can be
 *   terminated without taking the harness's event loop down with it.
 */
import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { loadCadKernel } from "./cad-harness.mjs";
import { drawingSvg, svgToPng } from "./drawing.mjs";

const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
port.on("message", async (/** @type {any} */ job) => {
  try {
    if (job.kind === "run") {
      const { kernel } = await loadCadKernel();
      const run = kernel.run(job.design);
      port.postMessage({ ok: true, run });
    } else {
      fs.writeFileSync(job.files.svg, drawingSvg(job.mesh, { title: job.files.title, date: job.date }));
      svgToPng(job.files.svg, job.files.png);
      port.postMessage({ ok: true });
    }
  } catch (e) {
    port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
