import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CadGenerationFailed } from "../../packages/cad-gen/src/errors.ts";
import { RenderTimeout } from "../../scripts/lib/kernel-worker.mjs";
import { runCase } from "../../scripts/lib/muse-sample.mjs";
import { box } from "./helpers/bench-meshes.js";

const GOOD = {
  triangles: 12, vertices: 8, volumeMm3: 1000,
  bboxMm: { min: [0, 0, 0], max: [20, 10, 5] }, bodies: { count: 1, boxes: [] },
};
// Two bodies, the second floating clear: the connected gate rejects it.
const SPLIT = {
  ...GOOD,
  bodies: { count: 2, boxes: [{ min: [0, 0, 0], max: [20, 10, 5] }, { min: [40, 0, 0], max: [45, 5, 5] }] },
};
const MESH = box([20, 10, 5]);
const KASE = {
  id: "pen_holder", spec: "# Design Specification\nA cup.", rubric: "r", referencePng: "/ref.png",
  strata: { method: "print", material: "PLA", components: 1 },
};

function generatorOf(/** @type {() => any} */ fail = () => null) {
  let n = 0;
  return {
    async generate() {
      const e = fail();
      if (e) throw e;
      n++;
      return {
        design: { code: "return box(" + n + ")", parameters: {}, summary: "cup" },
        diagnostics: { selection: { jevTokens: { prompt: 2, completion: 0 } }, attempts: [], tokens: { prompt: 10, completion: 5 } },
      };
    },
  };
}
const kernelOf = (/** @type {any[]} */ outcomes) => {
  let i = 0;
  return { run() { const o = outcomes[Math.min(i++, outcomes.length - 1)]; if (o instanceof Error) throw o; return { mesh: MESH, stats: o }; } };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "muse-case-"));
const base = (over) => ({ generator: generatorOf(), kernel: kernelOf([GOOD]), kase: KASE, dir: tmp(), draw: false, ...over });

describe("runCase stages", () => {
  it("passes both stages on a first-pass build", async () => {
    const r = await runCase(base({}));
    expect([r.stage1, r.stage2, r.firstPass]).toEqual([true, true, true]);
    expect([r.stage1Reason, r.stage2Reason]).toEqual([null, null]);
    expect(r.geometry).toEqual({ watertight: true, manifold: true, selfIntersectionFree: true, overlapFree: true });
    expect(r.tokens).toEqual({ prompt: 10, completion: 5 });
    expect(r.strata).toEqual(KASE.strata);
  });

  it("passes both stages after a client repair, not first-pass", async () => {
    const r = await runCase(base({ kernel: kernelOf([new Error("bad"), GOOD]) }));
    expect([r.stage1, r.stage2, r.firstPass]).toEqual([true, true, false]);
    expect(r.tokens).toEqual({ prompt: 20, completion: 10 });
  });

  it("fails stage 1 when the kernel throws on every round", async () => {
    const r = await runCase(base({ kernel: kernelOf([new Error("bad")]) }));
    expect([r.stage1, r.stage2, r.stage1Reason]).toEqual([false, false, "kernel_error"]);
    expect(r.geometry).toBeNull();
  });

  it("fails stage 2 when the last round builds but a gate rejects it", async () => {
    const r = await runCase(base({ kernel: kernelOf([SPLIT]) }));
    expect([r.stage1, r.stage2, r.stage2Reason]).toEqual([true, false, "gate:connected"]);
  });

  it("fails stage 1 with render_timeout when the build runs past the browser's limit", async () => {
    const kernel = { run: async () => { throw new RenderTimeout("build", 90000); } };
    const r = await runCase(base({ kernel }));
    expect([r.stage1, r.stage2, r.stage1Reason]).toEqual([false, false, "render_timeout"]);
    expect(r.error).toContain("timed out");
  });

  it("fails stage 1 on a provider error, a static failure and a timeout", async () => {
    const provider = await runCase(base({ generator: generatorOf(() => new Error("503")) }));
    expect(provider.stage1Reason).toBe("provider_error");
    const fail = new CadGenerationFailed("static", { attempts: [], tokens: { prompt: 7, completion: 1 } });
    const staticFail = await runCase(base({ generator: generatorOf(() => fail) }));
    expect(staticFail.stage1Reason).toBe("static_failed");
    const slow = { generate: (/** @type {any} */ input) => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")))) };
    const timeout = await runCase(base({ generator: slow, timeoutMs: 20 }));
    expect(timeout.stage1Reason).toBe("timeout");
  });
});

describe("runCase artifacts", () => {
  it("writes the STL, drawing and render for a delivered part", async () => {
    const dir = tmp();
    const r = await runCase(base({ dir, draw: true, drawImpl: (/** @type {any} */ _m, /** @type {any} */ files) => {
      for (const f of [files.svg, files.png]) fs.writeFileSync(f, "x");
    } }));
    expect(r.drawing).toBe("ok");
    for (const f of ["pen_holder.stl", "pen_holder.drawing.svg", "pen_holder.drawing.png", "pen_holder.render.png"]) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
  });

  it("records a drawing failure without failing the stages", async () => {
    const r = await runCase(base({ draw: true, drawImpl: () => { throw new Error("inkscape failed: boom"); } }));
    expect([r.stage1, r.stage2, r.drawing]).toEqual([true, true, "error"]);
    expect(r.drawingError).toContain("boom");
  });

  it("records a drawing that timed out as a drawing error", async () => {
    const r = await runCase(base({ draw: true, drawImpl: async () => { throw new RenderTimeout("drawing", 90000); } }));
    expect([r.stage2, r.drawing]).toEqual([true, "error"]);
    expect(r.drawingError).toContain("timed out");
  });

  it("writes nothing for a part that failed a stage", async () => {
    const dir = tmp();
    const r = await runCase(base({ dir, draw: true, kernel: kernelOf([SPLIT]) }));
    expect(r.drawing).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
