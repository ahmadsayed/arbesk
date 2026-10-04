import { describe, expect, it } from "bun:test";
import { CLIENT_REPAIR_ROUNDS, buildWithClientRepair } from "../../scripts/lib/client-repair.mjs";

/** Stats that pass every kernel gate. */
const GOOD = {
  triangles: 12, vertices: 8, volumeMm3: 1,
  bboxMm: { min: [0, 0, 0], max: [1, 1, 1] }, bodies: { count: 1, boxes: [] },
};

const design = (code) => ({ code, parameters: {}, summary: "a box" });
const first = () => ({ design: design("return cube(1)"), diagnostics: { selection: {} } });

/** A kernel replaying outcomes: stats objects are returned, Errors thrown. */
function kernelOf(outcomes) {
  let i = 0;
  return {
    run() {
      const o = outcomes[Math.min(i++, outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return { mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) }, stats: o };
    },
  };
}

/** A generator that records its inputs and returns numbered designs. */
function generatorOf() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    async generate(/** @type {any} */ input) {
      calls.push(input);
      return { design: design("return cube(" + (calls.length + 1) + ")"), diagnostics: { tokens: { prompt: 10, completion: 5 } } };
    },
  };
}

describe("buildWithClientRepair", () => {
  it("returns the first build when it passes the gates", async () => {
    const generator = generatorOf();
    const out = await buildWithClientRepair({ generator, kernel: kernelOf([GOOD]), prompt: "p" }, first());
    expect(out.run?.stats).toEqual(GOOD);
    expect(out.failures).toEqual([]);
    expect(out.results).toEqual([]);
    expect(generator.calls).toHaveLength(0);
  });

  it("repairs a kernel throw, sending the kernel's own error back", async () => {
    const generator = generatorOf();
    const repairs = [];
    const out = await buildWithClientRepair({
      generator, kernel: kernelOf([new Error("cube: size must be positive"), GOOD]), prompt: "p",
      onRepair: (round, failure) => repairs.push([round, failure.gate]),
    }, first());
    expect(out.run?.stats).toEqual(GOOD);
    expect(out.failures).toEqual([{ gate: "kernel", error: "cube: size must be positive" }]);
    expect(generator.calls[0].priorDesign.code).toBe("return cube(1)");
    expect(generator.calls[0].failures).toEqual([{ gate: "kernel", error: "cube: size must be positive" }]);
    expect(out.design.code).toBe("return cube(2)");
    expect(out.results).toHaveLength(1);
    expect(repairs).toEqual([[1, "kernel"]]);
  });

  it("names the failing gate", async () => {
    const out = await buildWithClientRepair(
      { generator: generatorOf(), kernel: kernelOf([{ ...GOOD, triangles: 0 }, GOOD]), prompt: "p" }, first());
    expect(out.failures[0].gate).toBe("nonempty");
    expect(out.failures[0].error.startsWith("nonempty: ")).toBe(true);
  });

  it("gives up after CLIENT_REPAIR_ROUNDS repairs", async () => {
    const generator = generatorOf();
    const out = await buildWithClientRepair(
      { generator, kernel: kernelOf([new Error("boom")]), prompt: "p" }, first());
    expect(out.run).toBeNull();
    expect(out.failures).toHaveLength(CLIENT_REPAIR_ROUNDS + 1);
    expect(generator.calls).toHaveLength(CLIENT_REPAIR_ROUNDS);
  });
});
