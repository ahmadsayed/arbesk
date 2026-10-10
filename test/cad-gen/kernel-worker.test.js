import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RENDER_TIMEOUT_MS, RenderTimeout, createWorkerKernel } from "../../scripts/lib/kernel-worker.mjs";

const CUBE = { code: "return box(P.s, P.s, P.s);", parameters: { s: { value: 10, unit: "mm" } }, summary: "cube" };

describe("createWorkerKernel", () => {
  it("matches the browser's 90 s render limit by default", () => {
    expect(RENDER_TIMEOUT_MS).toBe(90000);
  });

  it("builds a part off the main thread", async () => {
    const kernel = createWorkerKernel();
    const run = await kernel.run(CUBE);
    expect(run.stats.bodies.count).toBe(1);
    expect(run.stats.volumeMm3).toBeCloseTo(1000, 3);
    expect(run.mesh.positions).toBeInstanceOf(Float32Array);
  }, 60000);

  it("passes a kernel error through as an ordinary error", async () => {
    const kernel = createWorkerKernel();
    await expect(kernel.run({ ...CUBE, code: "throw new Error('nope');" })).rejects.toThrow("nope");
  }, 60000);

  it("gives up on a build that never finishes, and frees the main thread", async () => {
    const kernel = createWorkerKernel({ timeoutMs: 300, workerUrl: new URL("./helpers/hang-worker.mjs", import.meta.url) });
    const started = Date.now();
    await expect(kernel.run(CUBE)).rejects.toBeInstanceOf(RenderTimeout);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 20000);

  it("draws a sheet off the main thread", async () => {
    const kernel = createWorkerKernel();
    const { mesh } = await kernel.run(CUBE);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-"));
    const files = { svg: path.join(dir, "c.drawing.svg"), png: path.join(dir, "c.drawing.png"), title: "cube" };
    await kernel.draw(mesh, files);
    expect(fs.readFileSync(files.svg, "utf8")).toContain(">cube<");
  }, 60000);
});
