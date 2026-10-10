import { describe, expect, it } from "bun:test";
import path from "node:path";
import { paperRows, parseArgs, summariseRun } from "../../scripts/cad-bench-fn.mjs";

describe("cad-bench-fn parseArgs", () => {
  it("defaults to all tasks, two at a time", () => {
    expect(parseArgs([])).toMatchObject({ ids: null, limit: Infinity, concurrency: 2, resume: null });
  });
  it("reads ids, limit, concurrency, resume and out, and rejects nonsense", () => {
    const o = parseArgs(["--ids", "a, b", "--limit", "3", "--concurrency", "1", "--resume", "r", "--out", "o"]);
    expect(o).toMatchObject({ ids: ["a", "b"], limit: 3, concurrency: 1, resume: path.resolve("r"), out: path.resolve("o") });
    expect(() => parseArgs(["--concurrency", "x"])).toThrow(/--concurrency/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});

describe("summariseRun", () => {
  const records = [
    { id: "a", difficulty: "easy", order: 1, built: true, score: 1, reason: null },
    { id: "b", difficulty: "hard", order: 8, built: true, score: 0.5, reason: null },
    { id: "c", difficulty: "insane", order: 14, built: false, score: 0, reason: "gate:connected" },
    { id: "d", difficulty: "insane", order: 15, built: true, score: null, gradeError: "x", reason: null },
  ];
  const s = summariseRun(records, 17);

  it("computes CAD-bench's tier-weighted score, counting grade errors as zero like the benchmark", () => {
    // easy 1, hard 0.5, insane 0 -> (1 + 1.5 + 0) / 8
    expect(s.benchmark).toBeCloseTo((1 * 1 + 0.5 * 3 + 0 * 4) / 8, 9);
    expect(s.built).toBe(3);
    expect(s.gradeErrors).toBe(1);
    expect(s.reasons).toEqual({ "gate:connected": 1 });
  });

  it("is comparable only with all 17 tasks graded", () => {
    expect(s.comparable).toBe(false);
  });
});

describe("paperRows", () => {
  it("reads the paper's standalone rows from its bundled results", () => {
    const rows = paperRows({ results: [
      { table: "standalone_model", model: "m1", agent: "none", benchmark_score: 0.6, by_difficulty: { easy: 1 } },
      { table: "agent", model: "m2", agent: "codex", benchmark_score: 0.7, by_difficulty: {} },
      { table: "standalone_model", model: "deepseek-v4-flash", agent: "none", benchmark_score: 0.395, by_difficulty: {} },
    ] });
    expect(rows.map((r) => r.model)).toEqual(["m1", "deepseek-v4-flash"]);
  });
});
