import { describe, expect, it } from "bun:test";
import {
  agreementTemplate, compareSummaries, medianIqr, parseAgreement, renderMarkdown, summarise,
} from "../../scripts/lib/bench-summary.mjs";

const PENALTY = { chamfer: Math.sqrt(3), hausdorff: Math.sqrt(3), iogt: 0, iou: 0, iouReason: null };
const tokens = { prompt: 100, completion: 10 };
const r = (/** @type {any} */ over) => ({
  id: "x", outcome: "built", firstPass: true, rewrite: "scaled", suspect: false,
  strata: { geometric: "Simple", mesh: "Simple", compiled: 6, difficulty: "Easy" },
  metrics: { chamfer: 0.1, hausdorff: 0.2, iogt: 0.9, iou: 0.8, iouReason: null },
  clientFailures: [], tokens, jevTokens: { prompt: 5, completion: 0 }, durationMs: 1000, triage: null,
  ...over,
});
const RESULTS = [
  r({ id: "a" }),
  r({ id: "b", firstPass: false, metrics: { chamfer: 0.3, hausdorff: 0.4, iogt: 0.7, iou: null, iouReason: "x" } }),
  r({
    id: "c", outcome: "gate_failed", firstPass: false, metrics: PENALTY,
    strata: { geometric: "Complex", mesh: "Complex", compiled: 2, difficulty: "Hard" },
    clientFailures: [{ gate: "connected", error: "e" }],
    triage: { failureCause: { label: "gate_too_strict", confidence: 0.9, unsure: false }, gateFalsePositive: 0.8, promptFixable: 0.2, usage: { prompt: 50, completion: 0 } },
  }),
  r({
    id: "d", outcome: "refused", firstPass: false, metrics: PENALTY, suspect: true, rewrite: "fallback",
    triage: { failureCause: { label: "wrong_refusal", confidence: 0.4, unsure: true }, promptFixable: 0.1, usage: { prompt: 50, completion: 0 } },
  }),
];

describe("medianIqr", () => {
  it("interpolates like numpy and drops nulls", () => {
    expect(medianIqr([4, 1, 3, 2])).toEqual({ median: 2.5, iqr: 1.5, n: 4 });
    expect(medianIqr([1, null, 3])).toEqual({ median: 2, iqr: 1, n: 2 });
  });
});

describe("summarise", () => {
  const s = summarise(RESULTS, { variant: "measured" });

  it("computes rates and penalised medians over every sample", () => {
    expect(s.overall.n).toBe(4);
    expect(s.overall.compileRate).toBe(0.5);
    expect(s.overall.firstPassRate).toBe(0.25);
    expect(s.overall.iogt.median).toBeCloseTo(0.35, 12);
    expect(s.overall.iou.n).toBe(3);
    expect(s.overall.iouUnavailable).toBe(1);
  });

  it("groups by stratum, outcome and failing gate", () => {
    expect(Object.keys(s.byStratum.difficulty).sort()).toEqual(["Easy", "Hard"]);
    expect(s.byStratum.difficulty.Hard.n).toBe(1);
    expect(s.outcomes).toEqual({ built: 2, gate_failed: 1, refused: 1 });
    expect(s.failedGates).toEqual({ connected: 1 });
    expect(s.wrongRefusals).toEqual(["d"]);
    expect(s.suspect).toEqual(["d"]);
    expect(s.rewrites).toEqual({ scaled: 3, fallback: 1 });
  });

  it("tables triage causes, separating unsure answers", () => {
    expect(s.triage.failureCause).toEqual({
      gate_too_strict: { sure: ["c"], unsure: [] },
      wrong_refusal: { sure: [], unsure: ["d"] },
    });
    expect(s.triage.gateFalsePositiveRate).toBe(1);
    expect(s.triage.promptFixableRate).toBe(0);
  });

  it("sums cost", () => {
    expect(s.cost.deepseek).toEqual({ prompt: 400, completion: 40 });
    expect(s.cost.jev).toEqual({ prompt: 120, completion: 0 });
  });
});

describe("compareSummaries", () => {
  it("reports per-metric deltas", () => {
    const a = summarise(RESULTS, {});
    const b = summarise(RESULTS.slice(0, 2), {});
    const d = compareSummaries(a, b);
    expect(d.compileRate).toEqual({ current: 0.5, other: 1, delta: -0.5 });
  });
});

describe("agreement", () => {
  it("templates triaged samples and scores hand labels", () => {
    const md = agreementTemplate(RESULTS);
    expect(md).toContain("| c | failure_cause | gate_too_strict |  |");
    const filled = md
      .replace("| c | failure_cause | gate_too_strict |  |", "| c | failure_cause | gate_too_strict | gate_too_strict |")
      .replace("| d | failure_cause | wrong_refusal |  |", "| d | failure_cause | wrong_refusal | other |");
    expect(parseAgreement(filled)).toEqual({ labelled: 2, agreed: 1, rate: 0.5 });
  });
});

describe("renderMarkdown", () => {
  it("shows baselines, strata, triage as advisory, and deviations", () => {
    const md = renderMarkdown(summarise(RESULTS, { variant: "measured", model: "deepseek-flash" }), {});
    for (const text of ["GPT-4 zero-shot", "Compilation difficulty", "Where to improve", "advisory", "Deviations from the paper", "wrong_refusal"]) {
      expect(md).toContain(text);
    }
  });
});
