/**
 * Aggregates benchmark results into summary.json and summary.md.
 * @remarks Medians and IQRs are taken over EVERY sample with failures
 *   penalised, as the paper does (section 5), so a generator cannot improve its
 *   median by failing the hard cases. Exact IoU is the exception: a null (a
 *   non-manifold mesh) is excluded and counted, never treated as 0.
 */
import { COMPLEXITY_LEVELS, complexityBand } from "./bench-complexity.mjs";

/** Table 2 of the paper: median (IQR) and compile rate. */
export const PAPER_BASELINES = [
  { name: "GPT-4 zero-shot, Generated", iogt: [0.935, 0.043], chamfer: [0.153, 0.146], hausdorff: [0.484, 0.405], compileRate: 0.92 },
  { name: "GPT-4 few-shot, Generated", iogt: [0.939, 0.030], chamfer: [0.155, 0.140], hausdorff: [0.494, 0.368], compileRate: 0.96 },
  { name: "GPT-4 few-shot, CADCodeVerify", iogt: [0.944, 0.028], chamfer: [0.127, 0.135], hausdorff: [0.419, 0.356], compileRate: 0.965 },
  { name: "Gemini zero-shot, Generated", iogt: [0.905, 0.088], chamfer: [0.159, 0.180], hausdorff: [0.531, 0.451], compileRate: 0.85 },
  { name: "CodeLlama few-shot, CADCodeVerify", iogt: [0.935, 0.957], chamfer: [0.185, 1.620], hausdorff: [0.582, 1.366], compileRate: 0.735 },
];

const STRATA = /** @type {const} */ ([
  ["geometric", "Geometric complexity"], ["mesh", "Mesh complexity"], ["difficulty", "Compilation difficulty"],
]);

const DEVIATIONS = [
  "Measured prompts are rewritten into millimetres (x100); prompts with coordinate tuples or length arithmetic keep their numbers and state 1 unit = 100 mm instead (`rewrite: fallback`).",
  "Scores are for the HARDENED loop the harness composes: the server's static repair, then the harness's own kernel gates and up to 2 client repair rounds. The shipped browser worker currently renders once (guard, kernel, 3MF) with no geometric gates and no repair round, so compile and first-pass here are an upper bound on what the product does today; the server's /cad/repair contract is the path that would close the gap. The first-pass rate is the closest analogue of the paper's \"Generated\" rows.",
  "Both clouds are normalised by centroid and RMS radius before ICP (our parts are ~100x the ground truth); the paper aligns raw clouds. Metrics are taken after the paper's unit-cube normalisation.",
  "8192 area-weighted surface samples, seed 1; the paper does not state its sample count.",
  "Every metric is scale- and rotation-invariant by construction (both clouds are normalised before ICP and scored in the unit cube), so a part built 100x too small or too large still scores perfect: a unit or scale error shows up only in the design's own dimensions.",
  "The Jev complexity band in the report is an observe-only measurement of the request; nothing in production routes on it yet.",
  "The paper does not say which prompt variant Table 2 used; both are compared against the same rows.",
  "Exact IoU (Manifold booleans) is our addition; the paper's IoGT is a bounding-box ratio.",
];

/**
 * Linear-interpolated quantile of a sorted array (numpy's default).
 * @param {number[]} sorted @param {number} q
 * @returns {number}
 */
export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * @param {(number | null | undefined)[]} values
 * @returns {{ median: number, iqr: number, n: number }}
 */
export function medianIqr(values) {
  const s = /** @type {number[]} */ (values.filter((v) => typeof v === "number" && Number.isFinite(v))).sort((a, b) => a - b);
  return { median: quantile(s, 0.5), iqr: quantile(s, 0.75) - quantile(s, 0.25), n: s.length };
}

/**
 * @template T
 * @param {T[]} items @param {(item: T) => string} key
 * @returns {Record<string, number>}
 */
function countBy(items, key) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/** @param {any[]} list @returns {{ prompt: number, completion: number }} */
const sumTokens = (list) => list.reduce((s, t) => ({
  prompt: s.prompt + (t?.prompt ?? 0), completion: s.completion + (t?.completion ?? 0),
}), { prompt: 0, completion: 0 });

/** @param {any[]} results */
function aggregate(results) {
  const n = results.length;
  const pick = (/** @type {string} */ k) => results.map((r) => r.metrics[k]);
  return {
    n,
    compileRate: n ? results.filter((r) => r.outcome === "built").length / n : 0,
    firstPassRate: n ? results.filter((r) => r.firstPass).length / n : 0,
    iogt: medianIqr(pick("iogt")),
    chamfer: medianIqr(pick("chamfer")),
    hausdorff: medianIqr(pick("hausdorff")),
    iou: medianIqr(pick("iou")),
    iouUnavailable: results.filter((r) => r.metrics.iou === null).length,
  };
}

/**
 * Sample ids per triage label, sure and unsure apart.
 * @param {any[]} triaged @param {(t: any) => any} pick
 * @returns {Record<string, { sure: string[], unsure: string[] }>}
 */
function causesBy(triaged, pick) {
  /** @type {Record<string, { sure: string[], unsure: string[] }>} */
  const out = {};
  for (const r of triaged) {
    const label = pick(r.triage);
    if (!label) continue;
    const slot = (out[label.label] ??= { sure: [], unsure: [] });
    (label.unsure ? slot.unsure : slot.sure).push(r.id);
  }
  return out;
}

/**
 * Share of answered samples whose probability is at least 0.5.
 * @param {any[]} triaged @param {(t: any) => number | undefined} pick
 * @returns {number | null} null when nothing was answered.
 */
function rateOf(triaged, pick) {
  const answered = triaged.map((r) => pick(r.triage)).filter((p) => typeof p === "number");
  return answered.length ? answered.filter((p) => p >= 0.5).length / answered.length : null;
}

/**
 * @param {any[]} results SampleResults of one variant.
 * @param {object} config Run configuration, echoed into the summary.
 */
export function summarise(results, config) {
  /** @type {Record<string, Record<string, ReturnType<typeof aggregate>>>} */
  const byStratum = {};
  for (const [key] of STRATA) {
    /** @type {Record<string, any[]>} */
    const groups = {};
    for (const r of results) {
      const v = r.strata?.[key];
      if (v !== undefined) (groups[v] ??= []).push(r);
    }
    byStratum[key] = Object.fromEntries(Object.keys(groups).sort().map((k) => [k, aggregate(groups[k])]));
  }
  const triaged = results.filter((r) => r.triage && !r.triage.error);
  // Complexity bands are over the samples Jev scored; an unscored sample is
  // counted, never quietly dropped into a band it was not measured for.
  const scored = results.filter((r) => typeof r.complexity?.score === "number");
  /** @type {Record<string, any[]>} */
  const bands = {};
  for (const r of scored) (bands[complexityBand(r.complexity.score)] ??= []).push(r);
  const geometric = [...new Set(results.map((r) => r.strata?.geometric).filter((v) => v !== undefined))].sort();
  return {
    config,
    overall: aggregate(results),
    stratified: results.some((r) => r.strata),
    byStratum,
    byComplexity: Object.fromEntries(COMPLEXITY_LEVELS.map((label) => [label, aggregate(bands[label] ?? [])])),
    complexityUnscored: results.length - scored.length,
    complexityCrosstab: geometric.length
      ? Object.fromEntries(COMPLEXITY_LEVELS.map((label) => [label, Object.fromEntries(
        geometric.map((g) => [g, (bands[label] ?? []).filter((r) => r.strata?.geometric === g).length]))]))
      : null,
    outcomes: countBy(results, (r) => r.outcome),
    failedGates: countBy(results.filter((r) => r.outcome === "gate_failed"),
      (r) => r.clientFailures[r.clientFailures.length - 1]?.gate ?? "unknown"),
    rewrites: countBy(results, (r) => r.rewrite),
    suspect: results.filter((r) => r.suspect).map((r) => r.id),
    wrongRefusals: results.filter((r) => r.outcome === "refused").map((r) => r.id),
    triage: {
      triaged: triaged.length,
      errors: results.filter((r) => r.triage?.error).length,
      failureCause: causesBy(triaged, (t) => t.failureCause),
      shapeMismatch: causesBy(triaged, (t) => t.shapeMismatch),
      gateFalsePositiveRate: rateOf(triaged, (t) => t.gateFalsePositive),
      promptFixableRate: rateOf(triaged, (t) => t.promptFixable),
    },
    triageAgreement: null,
    cost: {
      deepseek: sumTokens(results.map((r) => r.tokens)),
      jev: sumTokens(results.flatMap((r) => [r.jevTokens, r.triage?.usage, r.complexity?.usage])),
      durationMs: results.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    },
  };
}

/**
 * Per-metric deltas, current minus other.
 * @param {any} current @param {any} other Summaries of the same variant.
 * @returns {Record<string, { current: number, other: number, delta: number }>}
 */
export function compareSummaries(current, other) {
  /** @type {Record<string, (s: any) => number>} */
  const metrics = {
    compileRate: (s) => s.overall.compileRate, firstPassRate: (s) => s.overall.firstPassRate,
    iogt: (s) => s.overall.iogt.median, chamfer: (s) => s.overall.chamfer.median,
    hausdorff: (s) => s.overall.hausdorff.median, iou: (s) => s.overall.iou.median,
    wrongRefusals: (s) => s.wrongRefusals.length,
  };
  return Object.fromEntries(Object.entries(metrics).map(([k, f]) =>
    [k, { current: f(current), other: f(other), delta: f(current) - f(other) }]));
}

/**
 * A hand-labelling sheet: up to max triaged samples, round-robin over labels
 * so every cause is represented.
 * @param {any[]} results @param {number} [max]
 * @returns {string} Markdown.
 */
export function agreementTemplate(results, max = 20) {
  /** @type {Map<string, { id: string, question: string, label: string }[]>} */
  const byLabel = new Map();
  for (const r of results) {
    const t = r.triage;
    const pick = t?.failureCause ? ["failure_cause", t.failureCause] : t?.shapeMismatch ? ["shape_mismatch", t.shapeMismatch] : null;
    if (!pick) continue;
    const [question, label] = pick;
    const list = byLabel.get(label.label) ?? [];
    list.push({ id: r.id, question, label: label.label });
    byLabel.set(label.label, list);
  }
  const rows = [];
  for (let i = 0; rows.length < max && [...byLabel.values()].some((l) => l.length > i); i++) {
    for (const list of byLabel.values()) if (list[i] && rows.length < max) rows.push(list[i]);
  }
  return [
    "# Triage agreement - hand labels",
    "",
    "Read each sample's JSON, then write the label YOU would give in the `human` column,",
    "chosen from the same list Jev chose from (see bench-triage.mjs). Leave it blank to skip.",
    "Then run: `bun scripts/cad-bench.mjs --agreement <runDir>`",
    "",
    "| id | question | jev | human |",
    "|---|---|---|---|",
    ...rows.map((r) => "| " + r.id + " | " + r.question + " | " + r.label + " |  |"),
    "",
  ].join("\n");
}

/**
 * Scores a filled-in agreement sheet.
 * @param {string} markdown
 * @returns {{ labelled: number, agreed: number, rate: number | null }}
 */
export function parseAgreement(markdown) {
  let labelled = 0, agreed = 0;
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*([^|\s]+)\s*\|\s*(failure_cause|shape_mismatch)\s*\|\s*(\w+)\s*\|\s*(\w*)\s*\|/.exec(line);
    if (!m || !m[4]) continue;
    labelled++;
    if (m[3] === m[4]) agreed++;
  }
  return { labelled, agreed, rate: labelled ? agreed / labelled : null };
}

/** @param {{ median: number, iqr: number }} m */
const mi = (m) => (Number.isFinite(m.median) ? m.median.toFixed(3) + " (" + m.iqr.toFixed(3) + ")" : "-");
/** @param {number} x */
const pct = (x) => (x * 100).toFixed(1) + "%";
/** Counts stay integers; rates and metrics keep three decimals. */
const num = (/** @type {number} */ x) => (Number.isInteger(x) ? String(x) : x.toFixed(3));

/**
 * Renders the human report.
 * @param {any} s A summary from summarise().
 * @param {{ compare?: Record<string, { current: number, other: number, delta: number }> | null }} options
 * @returns {string} Markdown.
 */
export function renderMarkdown(s, { compare = null } = {}) {
  const o = s.overall;
  const lines = [
    "# CADPrompt benchmark - " + (s.config.variant ?? "") + " prompts",
    "",
    "Model `" + (s.config.model ?? "?") +
      (s.config.thinking === undefined ? "" : ", thinking " + (s.config.thinking ? "on" : "off")) +
      ", Jev selector " + (s.config.jev === false ? "off" : "on") +
      ", " + o.n + " samples, dataset `" + (s.config.dataset ?? "?") + "`.",
    "",
    "## Headline",
    "",
    "| | IoGT ↑ | PC dist ↓ | Hausdorff ↓ | Compile ↑ | First pass ↑ | Exact IoU ↑ |",
    "|---|---|---|---|---|---|---|",
    "| **cad-gen** | " + mi(o.iogt) + " | " + mi(o.chamfer) + " | " + mi(o.hausdorff) + " | " + pct(o.compileRate) +
      " | " + pct(o.firstPassRate) + " | " + mi(o.iou) + (o.iouUnavailable ? " (" + o.iouUnavailable + " n/a)" : "") + " |",
    ...PAPER_BASELINES.map((b) => "| " + b.name + " | " + b.iogt[0].toFixed(3) + " (" + b.iogt[1].toFixed(3) + ") | " +
      b.chamfer[0].toFixed(3) + " (" + b.chamfer[1].toFixed(3) + ") | " + b.hausdorff[0].toFixed(3) + " (" +
      b.hausdorff[1].toFixed(3) + ") | " + pct(b.compileRate) + " | - | - |"),
    "",
    "Median (IQR); failures are penalised (distance √3, IoGT 0, IoU 0).",
    "",
  ];
  if (s.config.mixedRuns) {
    lines.push("**Mixed run**: this directory holds results from more than one run configuration " +
      "(a resume with changed flags, or a changed .env); the numbers below are not one run.", "");
  }
  if (compare) {
    lines.push("## Compared with the other run", "", "| metric | this run | other | delta |", "|---|---|---|---|",
      ...Object.entries(compare).map(([k, v]) => "| " + k + " | " + num(v.current) + " | " + num(v.other) +
        " | " + (v.delta >= 0 ? "+" : "") + num(v.delta) + " |"), "");
  }
  lines.push("## By stratum", "");
  if (!s.stratified) lines.push("_Unstratified: `unzip` or Data_Stratification.xlsx was unavailable._", "");
  for (const [key, title] of STRATA) {
    const groups = s.byStratum[key] ?? {};
    if (!Object.keys(groups).length) continue;
    lines.push("**" + title + "**", "", "| group | n | IoGT | PC dist | Compile | Exact IoU |", "|---|---|---|---|---|---|",
      ...Object.entries(groups).map(([g, a]) => "| " + g + " | " + a.n + " | " + mi(a.iogt) + " | " + mi(a.chamfer) +
        " | " + pct(a.compileRate) + " | " + mi(a.iou) + " |"), "");
  }
  lines.push("## By complexity (Jev)", "");
  const complexityBands = Object.entries(s.byComplexity ?? {});
  if (!complexityBands.some(([, a]) => a.n > 0)) {
    lines.push("_No complexity scores: JEV_API_KEY was unset, or every Jev call failed._", "");
  } else {
    if (s.complexityUnscored) {
      lines.push(s.complexityUnscored + " samples have no complexity score and are left out of the bands.", "");
    }
    lines.push("| band | n | compile | first pass | IoU median (IQR) |", "|---|---|---|---|---|",
      ...complexityBands.map(([band, a]) => "| " + band + " | " + (a.n
        ? a.n + " | " + pct(a.compileRate) + " | " + pct(a.firstPassRate) + " | " + mi(a.iou)
        : "0 | - | - | -") + " |"), "");
    const crosstab = s.complexityCrosstab;
    if (crosstab) {
      const columns = Object.keys(Object.values(crosstab)[0] ?? {});
      lines.push("**Band x geometric stratum**", "", "| band | " + columns.join(" | ") + " |",
        "|" + "---|".repeat(columns.length + 1),
        ...Object.entries(crosstab).map(([band, counts]) =>
          "| " + band + " | " + columns.map((c) => counts[c]).join(" | ") + " |"), "");
    }
  }
  lines.push("## Outcomes", "", "| outcome | count |", "|---|---|",
    ...Object.entries(s.outcomes).map(([k, v]) => "| " + k + " | " + v + " |"), "");
  if (Object.keys(s.failedGates).length) {
    lines.push("Failing gate after all repairs: " +
      Object.entries(s.failedGates).map(([g, n]) => "`" + g + "` " + n).join(", ") + ".", "");
  }
  if (s.wrongRefusals.length) {
    lines.push("**Wrong refusals** (every CADPrompt part is mechanical): " + s.wrongRefusals.join(", "), "");
  }
  const agreement = s.triageAgreement;
  lines.push("## Where to improve (Jev triage)", "",
    agreement?.rate != null
      ? "Jev agreed with hand labels on " + agreement.agreed + "/" + agreement.labelled + " (" + pct(agreement.rate) + ") samples."
      : "_Treat this table as advisory: no hand-labelled agreement check has been recorded yet " +
        "(fill triage-agreement.md, then run `--agreement`)._",
    "", "Triaged " + s.triage.triaged + " samples" + (s.triage.errors ? ", " + s.triage.errors + " Jev errors" : "") + ".", "");
  for (const [title, table] of /** @type {const} */ ([["Failure cause", "failureCause"], ["Shape mismatch", "shapeMismatch"]])) {
    const rows = Object.entries(s.triage[table]).sort((a, b) => b[1].sure.length - a[1].sure.length);
    if (!rows.length) continue;
    lines.push("**" + title + "**", "", "| label | sure | unsure | samples |", "|---|---|---|---|",
      ...rows.map(([label, v]) => "| " + label + " | " + v.sure.length + " | " + v.unsure.length + " | " +
        [...v.sure, ...v.unsure.map((/** @type {string} */ id) => id + "?")].join(", ") + " |"), "");
  }
  if (s.triage.gateFalsePositiveRate != null) lines.push("Gate false-positive rate: " + pct(s.triage.gateFalsePositiveRate) + ".");
  if (s.triage.promptFixableRate != null) lines.push("Prompt/docs-fixable rate: " + pct(s.triage.promptFixableRate) + ".");
  lines.push("", "## Cost", "",
    "DeepSeek " + s.cost.deepseek.prompt + " in / " + s.cost.deepseek.completion + " out tokens; Jev " +
      s.cost.jev.prompt + " in tokens; " + (s.cost.durationMs / 60000).toFixed(1) + " sample-minutes.", "",
    "## Rewrites", "", "Rewrite kinds: " + Object.entries(s.rewrites).map(([k, v]) => k + " " + v).join(", ") + "." +
      (s.suspect.length ? " Suspect (read these): " + s.suspect.join(", ") + "." : ""), "",
    "## Deviations from the paper", "", ...DEVIATIONS.map((d) => "- " + d), "");
  return lines.join("\n");
}
