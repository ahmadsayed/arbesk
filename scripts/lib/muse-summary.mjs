/**
 * MUSE run aggregation: the paper's funnel, its leaderboard rows, and the report.
 * @remarks MUSE scores a strict funnel - a case that fails code or geometry
 *   scores 0 on every later metric - and its Final Score is the mean of three
 *   sub-scores over all cases. Two things are NOT zeros here: a case the judge
 *   could not score and a case whose drawing failed. Neither says anything
 *   about the part, so both leave the Stage 3 denominator and are counted
 *   instead; a run with any unscored case is never labelled leaderboard-
 *   comparable.
 */
import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, JUDGE_MODEL } from "./muse-judge.mjs";
import { writeJsonAtomic } from "./bench-io.mjs";

/**
 * The paper's leaderboard rows: code %, geometry %, final %.
 * @remarks Dong, Li & Wu, "MUSE: Benchmarking Manufacturable, Functional, and
 *   Assemblable Text-to-CAD Generation", arXiv 2605.28579 (2026), main table.
 */
export const PAPER_BASELINES = Object.freeze([
  { model: "GPT-5.5", code: 77.36, geometry: 70.75, final: 52.36 },
  { model: "Gemini 3.1 Pro", code: 65.09, geometry: 58.49, final: 43.40 },
  { model: "Claude Opus 4.7", code: 76.42, geometry: 60.38, final: 39.47 },
  { model: "GLM-5.1 (best open-source)", code: 31.13, geometry: 27.36, final: 18.87 },
]);

/** How this harness differs from the paper - printed in every report. */
export const DEVIATIONS = Object.freeze([
  "Code is cad-gen's Manifold-prelude JavaScript, not CadQuery; \"executes\" means the in-process kernel produced a mesh.",
  "Stage 2 is stricter and partly guaranteed by construction: Manifold output is watertight, manifold, self-intersection free and overlap free, and a part cad-gen's own kernel gates reject (connected, pieces, nonempty, budget) fails Stage 2 because the product would not deliver it.",
  "Drawings come from arbesk's own renderer in MUSE's sheet layout, not from MUSE's unpublished DrawCAD; feature dimensions such as diameters are not drawn.",
  "One sample per case, judged by Gemini-3.1-Pro at temperature 0; the paper does not state its judge temperature.",
  "The prompt is each case's design_description.md verbatim, with no hints or rewrites.",
]);

/** @param {number} n @param {number} d */
const pct = (n, d) => (d === 0 ? 0 : (n / d) * 100);

/**
 * One case's Stage 3 value: a number, or why it has none.
 * @param {any} c Case record. @param {any} s Score record or undefined.
 * @returns {{ value: number, sub: Record<string, number>, items: number[] } | "drawing_error" | "judge_error" | "pending"}
 */
function stage3(c, s) {
  const zero = { value: 0, sub: { functionality: 0, manufacturability: 0, assemblability: 0 }, items: CATEGORIES.map(() => 0) };
  if (!c.stage1 || !c.stage2) return zero;
  if (c.drawing === "error") return "drawing_error";
  if (!s) return "pending";
  if (s.judgeError) return "judge_error";
  return { value: s.score, sub: s.subScores, items: s.items.map((/** @type {any} */ i) => i.score) };
}

/**
 * The funnel over a set of cases.
 * @param {any[]} cases @param {Map<string, any>} scores
 */
function funnel(cases, scores) {
  const values = cases.map((c) => stage3(c, scores.get(c.id))).filter((v) => typeof v === "object");
  /** @param {(v: any) => number} pick */
  const mean = (pick) => pct(values.reduce((sum, v) => sum + pick(v), 0), values.length);
  return {
    n: cases.length,
    code: pct(cases.filter((c) => c.stage1).length, cases.length),
    geometry: pct(cases.filter((c) => c.stage2).length, cases.length),
    final: mean((v) => v.value),
    functionality: mean((v) => v.sub.functionality),
    manufacturability: mean((v) => v.sub.manufacturability),
    assemblability: mean((v) => v.sub.assemblability),
    judged: values.length,
  };
}

/** @param {number | null} k */
const componentBand = (k) => (k === null ? "unknown" : k <= 1 ? "1" : k <= 5 ? "2-5" : "6+");

/**
 * @param {any[]} cases @param {(c: any) => string} key @param {Map<string, any>} scores
 * @returns {Record<string, ReturnType<typeof funnel>>}
 */
function groupFunnel(cases, key, scores) {
  /** @type {Record<string, any[]>} */
  const groups = {};
  for (const c of cases) (groups[key(c)] ??= []).push(c);
  return Object.fromEntries(Object.entries(groups).map(([k, cs]) => [k, funnel(cs, scores)]));
}

/** @param {string[]} reasons */
const tally = (reasons) => reasons.reduce((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({}));

/**
 * Aggregates a run.
 * @param {any[]} cases Case records. @param {Map<string, any>} scores Score records by id.
 * @param {{ filtered: boolean }} config Whether the run was restricted (--ids, --limit, --method).
 */
export function summarise(cases, scores, config) {
  const states = cases.map((c) => stage3(c, scores.get(c.id)));
  const judged = states.filter((v) => typeof v === "object");
  const scoreRecords = cases.map((c) => scores.get(c.id)).filter((s) => s && !s.judgeError);
  const pending = states.filter((v) => v === "pending").length;
  return {
    headline: funnel(cases, scores),
    categoryPassRates: Object.fromEntries(CATEGORIES.map((cat, i) =>
      [cat, pct(judged.reduce((sum, v) => sum + /** @type {any} */ (v).items[i], 0), judged.length)])),
    byMethod: groupFunnel(cases, (c) => c.strata?.method ?? "other", scores),
    byComponents: groupFunnel(cases, (c) => componentBand(c.strata?.components ?? null), scores),
    stage1Reasons: tally(cases.filter((c) => !c.stage1).map((c) => c.stage1Reason ?? "unknown")),
    stage2Reasons: tally(cases.filter((c) => c.stage1 && !c.stage2).map((c) => c.stage2Reason ?? "unknown")),
    judge: {
      model: JUDGE_MODEL,
      scored: scoreRecords.length,
      errors: states.filter((v) => v === "judge_error").length,
      mismatches: scoreRecords.filter((s) => s.mismatch).length,
      tokens: scoreRecords.reduce((t, s) => ({
        prompt: t.prompt + (s.usage?.prompt ?? 0), completion: t.completion + (s.usage?.completion ?? 0),
        thoughts: t.thoughts + (s.usage?.thoughts ?? 0),
      }), { prompt: 0, completion: 0, thoughts: 0 }),
      seconds: scoreRecords.reduce((t, s) => t + (s.latencyMs ?? 0), 0) / 1000,
    },
    generation: {
      tokens: cases.reduce((t, c) => ({ prompt: t.prompt + (c.tokens?.prompt ?? 0), completion: t.completion + (c.tokens?.completion ?? 0) }),
        { prompt: 0, completion: 0 }),
      seconds: cases.reduce((t, c) => t + (c.durationMs ?? 0), 0) / 1000,
    },
    drawingErrors: states.filter((v) => v === "drawing_error").length,
    pending,
    leaderboardComparable: cases.length === 106 && !config.filtered && pending === 0,
  };
}

/** @param {number} v */
const f1 = (v) => v.toFixed(1);

/**
 * Why a run cannot sit beside the leaderboard.
 * @param {ReturnType<typeof summarise>} s
 */
function notComparableBecause(s) {
  const reasons = [];
  if (s.headline.n !== 106) reasons.push(s.headline.n + " of 106 cases");
  if (s.pending) reasons.push(s.pending + " passed cases not yet judged");
  return reasons.length ? reasons.join(", ") : "a filtered run";
}

/**
 * The run's summary.md.
 * @param {ReturnType<typeof summarise>} s
 * @returns {string}
 */
export function renderMarkdown(s) {
  const h = s.headline;
  const lines = [
    "# MUSE benchmark - cad-gen", "",
    s.leaderboardComparable
      ? "All 106 cases, fully judged: leaderboard-comparable (see the deviations below)."
      : "**This run is not leaderboard-comparable**: " + notComparableBecause(s) + ".",
    "", "## Headline", "",
    "| | Code % | Geometry % | Final % | Functionality | Manufacturability | Assemblability |",
    "|---|---|---|---|---|---|---|",
    `| **cad-gen** | ${f1(h.code)} | ${f1(h.geometry)} | ${f1(h.final)} | ${f1(h.functionality)} | ${f1(h.manufacturability)} | ${f1(h.assemblability)} |`,
    ...PAPER_BASELINES.map((b) => `| ${b.model} (paper) | ${f1(b.code)} | ${f1(b.geometry)} | ${f1(b.final)} | - | - | - |`),
    "", `Stage 3 is averaged over ${h.judged} judged cases; judge errors (${s.judge.errors}) and drawing errors (${s.drawingErrors}) are excluded, not zeroed.`,
    "", "## By manufacturing method", "", ...groupTable(s.byMethod),
    "", "## By component count", "", ...groupTable(s.byComponents),
    "", "## Rubric pass rates", "", "| Category | Pass % |", "|---|---|",
    ...Object.entries(s.categoryPassRates).map(([c, v]) => `| ${c} | ${f1(v)} |`),
    "", "## Failures", "",
    "Stage 1: " + (Object.entries(s.stage1Reasons).map(([k, v]) => k + " " + v).join(", ") || "none"),
    "", "Stage 2: " + (Object.entries(s.stage2Reasons).map(([k, v]) => k + " " + v).join(", ") || "none"),
    "", "## Judge and cost", "",
    `Judge ${s.judge.model}: ${s.judge.scored} scored, ${s.judge.errors} errors, ${s.judge.mismatches} normalisation mismatches; `
      + `${s.judge.tokens.prompt} in / ${s.judge.tokens.completion} out / ${s.judge.tokens.thoughts} thinking tokens; ${f1(s.judge.seconds)} s.`,
    "", `Generation: ${s.generation.tokens.prompt} in / ${s.generation.tokens.completion} out DeepSeek tokens; ${f1(s.generation.seconds)} sample-seconds.`,
    "", "## Deviations from the paper", "", ...DEVIATIONS.map((d) => "- " + d),
    "", "---", "", "MUSE dataset (c) its authors, CC BY 4.0; judge prompt from the MUSE harness, MIT. "
      + "Dong, Li & Wu, arXiv 2605.28579.", "",
  ];
  return lines.join("\n");
}

/** @param {Record<string, any>} groups */
function groupTable(groups) {
  return ["| Group | n | Code % | Geometry % | Final % |", "|---|---|---|---|---|",
    ...Object.entries(groups).sort().map(([k, g]) => `| ${k} | ${g.n} | ${f1(g.code)} | ${f1(g.geometry)} | ${f1(g.final)} |`)];
}

/** @param {unknown} v @returns {string} */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * One HTML card: the reference sheet beside ours, the stages and the rubric.
 * @param {any} c @param {any} s @param {string} runDir
 */
function card(c, s, runDir) {
  const ref = path.relative(runDir, c.referencePng ?? "");
  const ours = c.drawing === "ok" ? `<img loading="lazy" src="${esc(c.id)}.drawing.png" alt="cad-gen drawing">` : "<p class=none>no drawing</p>";
  const stage = !c.stage1 ? "Stage 1 failed: " + esc(c.stage1Reason) : !c.stage2 ? "Stage 2 failed: " + esc(c.stage2Reason) : "Stages 1-2 passed";
  const rubric = s && !s.judgeError
    ? "<ul>" + s.items.map((/** @type {any} */ i) => `<li class="${i.score ? "pass" : "fail"}"><b>${esc(i.category)}</b>: ${esc(i.rationale)}</li>`).join("") + "</ul>"
    : s?.judgeError ? "<p class=none>judge error: " + esc(s.judgeError) + "</p>" : "";
  const score = s && !s.judgeError ? f1(s.score * 100) + "%" : "-";
  return `<section><h2>${esc(c.id)} <small>${esc(c.strata?.method)} · ${esc(c.strata?.components)} parts · ${score}</small></h2>`
    + `<p>${stage}</p><div class=pair><figure><img loading="lazy" src="${esc(ref)}" alt="MUSE reference"><figcaption>MUSE reference</figcaption></figure>`
    + `<figure>${ours}<figcaption>cad-gen</figcaption></figure></div>${rubric}</section>`;
}

/**
 * Writes summary.json, summary.md and index.html into the run directory.
 * @param {string} runDir @param {ReturnType<typeof summarise>} summary
 * @param {any[]} cases @param {Map<string, any>} scores
 */
export function writeReport(runDir, summary, cases, scores) {
  writeJsonAtomic(path.join(runDir, "summary.json"), summary);
  fs.writeFileSync(path.join(runDir, "summary.md"), renderMarkdown(summary));
  const h = summary.headline;
  const html = "<!doctype html><meta charset=utf-8><title>MUSE - cad-gen</title>"
    + "<style>body{font:14px system-ui;margin:16px;max-width:1400px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}"
    + "img{width:100%;border:1px solid #ccc}li.pass{color:#165}li.fail{color:#a12}.none{color:#888}small{color:#666;font-weight:normal}</style>"
    + `<h1>MUSE - cad-gen</h1><p>Code ${f1(h.code)}% · Geometry ${f1(h.geometry)}% · Final ${f1(h.final)}% over ${h.n} cases`
    + (summary.leaderboardComparable ? "" : " (not leaderboard-comparable)") + "</p>"
    + cases.map((c) => card(c, scores.get(c.id), runDir)).join("");
  fs.writeFileSync(path.join(runDir, "index.html"), html);
}
