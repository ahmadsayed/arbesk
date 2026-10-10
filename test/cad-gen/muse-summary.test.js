import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CATEGORIES } from "../../scripts/lib/muse-judge.mjs";
import { DEVIATIONS, PAPER_BASELINES, renderMarkdown, summarise, writeReport } from "../../scripts/lib/muse-summary.mjs";

const strata = (method = "print", components = 1) => ({ method, material: "PLA", components });
const kase = (id, over = {}) => ({
  id, strata: strata(), stage1: true, stage1Reason: null, stage2: true, stage2Reason: null,
  drawing: "ok", tokens: { prompt: 10, completion: 5 }, durationMs: 1000, ...over,
});
/** A score whose six items pass where `passes` says so. */
const scored = (passes) => {
  const items = CATEGORIES.map((c, i) => ({ category: c, score: passes[i], rationale: "why <" + c + ">" }));
  const score = passes.reduce((a, b) => a + b, 0) / 6;
  const pair = (a, b) => (passes[CATEGORIES.indexOf(a)] + passes[CATEGORIES.indexOf(b)]) / 2;
  return {
    model: "gemini-3.1-pro-preview", items, score, mismatch: false, summary: "s",
    subScores: {
      functionality: pair("Functional Adaptation", "Usage Stability"),
      manufacturability: pair("Tolerance", "Manufacturability"),
      assemblability: pair("Assembly Readiness", "Joint Design"),
    },
    usage: { prompt: 4700, completion: 400, thoughts: 1000 }, latencyMs: 18000,
  };
};
const ALL = [1, 1, 1, 1, 1, 1];
const HALF = [1, 1, 1, 0, 0, 0];

describe("summarise", () => {
  const cases = [
    kase("a", { stage1: false, stage2: false, stage1Reason: "kernel_error", drawing: null }),
    kase("b", { stage2: false, stage2Reason: "gate:connected", drawing: null }),
    kase("c"),
    kase("d", { strata: strata("cnc", 9) }),
  ];
  const scores = new Map([["c", scored(ALL)], ["d", scored(HALF)]]);

  it("zeroes later stages for cases that failed an earlier one", () => {
    const s = summarise(cases, scores, { filtered: false });
    expect(s.headline).toMatchObject({ n: 4, code: 75, geometry: 50, final: 37.5 });
    expect(s.stage1Reasons).toEqual({ kernel_error: 1 });
    expect(s.stage2Reasons).toEqual({ "gate:connected": 1 });
  });

  it("pairs the sub-scores like the paper", () => {
    const s = summarise(cases, scores, { filtered: false });
    // d passes Assembly Readiness, Joint Design, Tolerance only.
    expect(s.headline.functionality).toBeCloseTo((0 + 0 + 1 + 0) / 4 * 100, 9);
    expect(s.headline.assemblability).toBeCloseTo((0 + 0 + 1 + 1) / 4 * 100, 9);
    expect(s.headline.manufacturability).toBeCloseTo((0 + 0 + 1 + 0.5) / 4 * 100, 9);
  });

  it("leaves judge errors and drawing errors out of the denominator, and counts them", () => {
    const more = [...cases, kase("e"), kase("f", { drawing: "error" })];
    const s = summarise(more, new Map([...scores, ["e", { model: "m", judgeError: "HTTP 500" }]]), { filtered: false });
    expect(s.headline.final).toBe(37.5);
    expect(s.judge.errors).toBe(1);
    expect(s.drawingErrors).toBe(1);
    expect(s.headline.n).toBe(6);
  });

  it("groups by manufacturing method and component count", () => {
    const s = summarise(cases, scores, { filtered: false });
    expect(s.byMethod.cnc).toMatchObject({ n: 1, final: 50 });
    expect(s.byMethod.print.n).toBe(3);
    expect(s.byMethod.print.code).toBeCloseTo(200 / 3, 9);
    expect(Object.keys(s.byComponents).sort()).toEqual(["1", "6+"]);
  });

  it("is leaderboard-comparable only for all 106 cases, unfiltered and fully judged", () => {
    expect(summarise(cases, scores, { filtered: false }).leaderboardComparable).toBe(false);
    const full = Array.from({ length: 106 }, (_, i) => kase("k" + i));
    const allScored = new Map(full.map((c) => [c.id, scored(ALL)]));
    expect(summarise(full, allScored, { filtered: false }).leaderboardComparable).toBe(true);
    expect(summarise(full, allScored, { filtered: true }).leaderboardComparable).toBe(false);
    const pending = new Map([...allScored].slice(1));
    const s = summarise(full, pending, { filtered: false });
    expect([s.pending, s.leaderboardComparable]).toEqual([1, false]);
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(summarise([kase("c")], new Map([["c", scored(ALL)]]), { filtered: true }));

  it("puts the headline beside the paper's rows", () => {
    expect(md).toContain("**cad-gen**");
    for (const row of PAPER_BASELINES) expect(md).toContain(row.model);
  });

  it("carries every deviation and the attribution", () => {
    for (const d of DEVIATIONS) expect(md).toContain(d);
    expect(md).toContain("MUSE dataset (c) its authors, CC BY 4.0; judge prompt from the MUSE harness, MIT");
  });

  it("says when a run is not leaderboard-comparable", () => {
    expect(md).toContain("not leaderboard-comparable");
  });
});

describe("writeReport", () => {
  it("writes the summary files and an escaped HTML report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-report-"));
    const cases = [kase("c")];
    const scores = new Map([["c", scored(ALL)]]);
    writeReport(dir, summarise(cases, scores, { filtered: true }), cases, scores);
    for (const f of ["summary.json", "summary.md", "index.html"]) expect(fs.existsSync(path.join(dir, f))).toBe(true);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("why &lt;Tolerance&gt;");
    expect(html).not.toContain("why <Tolerance>");
  });
});
