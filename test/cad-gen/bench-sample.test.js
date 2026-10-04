import { describe, expect, it } from "bun:test";
import { CadGenerationFailed, CadRequestUnsuitable } from "../../packages/cad-gen/src/errors.ts";
import { CLIENT_REPAIR_ROUNDS } from "../../scripts/lib/client-repair.mjs";
import { PENALTY, runSample } from "../../scripts/lib/bench-sample.mjs";

const GOOD = {
  triangles: 12, vertices: 8, volumeMm3: 1,
  bboxMm: { min: [0, 0, 0], max: [1, 1, 1] }, bodies: { count: 1, boxes: [] },
};
const MESH = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
const SAMPLE = {
  id: "00000007", variant: "measured", prompt: "Create a cube of 50 mm.", rewrite: "scaled", suspect: false,
  gtStlPath: "/gt.stl", gtJson: { Width_mm: 0.5 }, strata: null,
};
const METRICS = { chamfer: 0.1, hausdorff: 0.3, iogt: 0.9, iou: 0.8, iouReason: null };

/** A generator returning designs, or throwing what `fail` gives it. */
function generatorOf(/** @type {() => any} */ fail = () => null) {
  let n = 0;
  return {
    async generate() {
      const e = fail();
      if (e) throw e;
      n++;
      return {
        design: { code: "return cube(" + n + ")", parameters: {}, summary: "cube" },
        diagnostics: { selection: { jevTokens: { prompt: 3, completion: 0 } }, attempts: [], tokens: { prompt: 100, completion: 50 } },
      };
    },
  };
}
const kernelOf = (/** @type {any[]} */ outcomes) => {
  let i = 0;
  return { run() { const o = outcomes[Math.min(i++, outcomes.length - 1)]; if (o instanceof Error) throw o; return { mesh: MESH, stats: o }; } };
};
const score = () => METRICS;

describe("runSample", () => {
  it("scores a first-pass build", async () => {
    const { result, mesh } = await runSample({ generator: generatorOf(), kernel: kernelOf([GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("built");
    expect(result.firstPass).toBe(true);
    expect(result.metrics).toEqual(METRICS);
    expect(result.tokens).toEqual({ prompt: 100, completion: 50 });
    expect(result.jevTokens).toEqual({ prompt: 3, completion: 0 });
    expect(mesh).toBe(MESH);
  });

  it("counts repair tokens and is not first-pass after a client repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([new Error("bad"), GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("built");
    expect(result.firstPass).toBe(false);
    expect(result.clientFailures).toEqual([{ gate: "kernel", error: "bad" }]);
    expect(result.tokens).toEqual({ prompt: 200, completion: 100 });
    expect(result.design.code).toBe("return cube(2)");
  });

  it("classifies an unsuitability refusal and applies the penalty", async () => {
    const { result, mesh } = await runSample({
      generator: generatorOf(() => new CadRequestUnsuitable("organic", 0.1)), kernel: kernelOf([GOOD]), score, sample: SAMPLE,
    });
    expect(result.outcome).toBe("refused");
    expect(result.metrics).toEqual(PENALTY);
    expect(mesh).toBeNull();
  });

  it("classifies exhausted static repair and keeps its tokens", async () => {
    const { result } = await runSample({
      generator: generatorOf(() => new CadGenerationFailed("failed", { tokens: { prompt: 7, completion: 2 } })),
      kernel: kernelOf([GOOD]), score, sample: SAMPLE,
    });
    expect(result.outcome).toBe("static_failed");
    expect(result.tokens).toEqual({ prompt: 7, completion: 2 });
  });

  it("classifies a kernel throw that survives every repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([new Error("boom")]), score, sample: SAMPLE });
    expect(result.outcome).toBe("kernel_error");
    expect(result.clientFailures).toHaveLength(CLIENT_REPAIR_ROUNDS + 1);
    expect(result.metrics).toEqual(PENALTY);
  });

  it("classifies a gate failure that survives every repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([{ ...GOOD, triangles: 0 }]), score, sample: SAMPLE });
    expect(result.outcome).toBe("gate_failed");
    expect(result.error.startsWith("nonempty: ")).toBe(true);
  });

  it("classifies a provider error", async () => {
    const { result } = await runSample({ generator: generatorOf(() => new Error("HTTP 500")), kernel: kernelOf([GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("provider_error");
    expect(result.error).toBe("HTTP 500");
  });

  it("times out through the generate signal", async () => {
    const generator = {
      generate: (/** @type {any} */ input) => new Promise((_, reject) =>
        input.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const { result } = await runSample({ generator, kernel: kernelOf([GOOD]), score, sample: SAMPLE, timeoutMs: 10 });
    expect(result.outcome).toBe("timeout");
    expect(result.metrics).toEqual(PENALTY);
  });
});
