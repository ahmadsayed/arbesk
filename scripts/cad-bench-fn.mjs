/**
 * CAD-bench functional-CAD benchmark for @arbesk/cad-gen.
 *
 * Runs CAD-bench's 17 public tasks (ICML 2026; github.com/CAD-bench/cad-bench,
 * MIT) - basic solids to threaded pairs and working gear trains - through
 * cad-gen's hardened loop, wraps each delivered mesh as a Build123D final.py
 * (scripts/lib/cadbench-bridge.mjs) and grades it with CAD-bench's own verifier
 * container, offline. The score is the benchmark's: tier means weighted
 * 1/2/3/4 (easy, medium, hard, insane).
 *
 * Usage:
 *   bun scripts/cad-bench-fn.mjs [--ids a,b] [--limit N] [--concurrency 2]
 *                                [--resume <runDir>] [--regrade <runDir>]
 *                                [--out test-results/cad-bench-fn]
 *
 * --regrade re-bridges and re-grades every built task from its saved part.stl
 * (after a bridge or verifier fix) without generating anything.
 *
 * Needs Docker, DEEPSEEK_API_KEY (and the Jev settings) in .env. The first run
 * clones CAD-bench at its pinned commit and builds the verifier image.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nextRunDir, pool, readJson, writeJsonAtomic } from "./lib/bench-io.mjs";
import { PROJECT_ROOT, cadGeneratorFrom, requireEnv } from "./lib/cad-harness.mjs";
import { commaList, parseFlags, positiveInt } from "./lib/cli-args.mjs";
import { CADBENCH_COMMIT, benchmarkScore, fetchCadBench, loadTasks } from "./lib/cadbench.mjs";
import { VERIFIER_IMAGE, gradeSubmission } from "./lib/cadbench-grade.mjs";
import { regradeTask, runTask } from "./lib/cadbench-task.mjs";
import { createWorkerKernel } from "./lib/kernel-worker.mjs";

const DEFAULT_OUT = path.join(PROJECT_ROOT, "test-results", "cad-bench-fn");
const REPO_ROOT = path.join(PROJECT_ROOT, "test-results", "cad-bench-fn-repo");
/** Each verifier container asks for 4 CPUs and 8 GB, so two at a time. */
const DEFAULT_CONCURRENCY = 2;

/**
 * @param {string[]} argv Arguments after the script path.
 */
export function parseArgs(argv) {
  const opts = {
    ids: /** @type {string[] | null} */ (null), limit: Infinity, concurrency: DEFAULT_CONCURRENCY,
    resume: /** @type {string | null} */ (null), regrade: /** @type {string | null} */ (null), out: DEFAULT_OUT,
  };
  parseFlags(argv, {
    "--ids": (value) => { opts.ids = commaList(value()); },
    "--limit": (value) => { opts.limit = positiveInt("--limit", value()); },
    "--concurrency": (value) => { opts.concurrency = positiveInt("--concurrency", value()); },
    "--resume": (value) => { opts.resume = path.resolve(value()); },
    "--regrade": (value) => { opts.regrade = path.resolve(value()); },
    "--out": (value) => { opts.out = path.resolve(value()); },
  });
  if (opts.regrade && opts.resume) throw new Error("--regrade contradicts --resume");
  return opts;
}

/**
 * Aggregates task records.
 * @remarks Grade errors count as zero in the benchmark score - CAD-bench's own
 *   rule for a missing reward - but are counted separately and make the run
 *   not comparable, so a broken grader can never pass for a weak generator.
 * @param {any[]} records @param {number} totalTasks
 */
export function summariseRun(records, totalTasks) {
  const { benchmark, tiers } = benchmarkScore(records.map((r) => ({ difficulty: r.difficulty, score: r.score })));
  const gradeErrors = records.filter((r) => r.gradeError).length;
  return {
    benchmark, tiers, n: records.length, built: records.filter((r) => r.built).length,
    gradeErrors,
    reasons: records.filter((r) => !r.built).reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }),
      /** @type {Record<string, number>} */ ({})),
    comparable: records.length === totalTasks && gradeErrors === 0,
  };
}

/**
 * The paper's standalone-model rows from CAD-bench's bundled results.
 * @param {any} reported metadata/cad-bench-reported-results.json
 * @returns {{ model: string, score: number, tiers: Record<string, number> }[]}
 */
export function paperRows(reported) {
  /** @type {any[]} */
  const results = reported?.results ?? [];
  return results
    .filter((r) => r.table === "standalone_model")
    .map((r) => ({ model: String(r.model), score: Number(r.benchmark_score), tiers: r.by_difficulty ?? {} }))
    .sort((a, b) => b.score - a.score);
}

/** @param {number | undefined} v */
const f3 = (v) => (typeof v === "number" ? v.toFixed(3) : "-");

/**
 * Why a task scored what it did, when that is not the score itself.
 * @remarks A part that passes every task check yet reads as ~100% different
 *   from the reference has not failed geometrically: OCC's boolean failed on
 *   the mesh-built solid (seen on a slotted plate whose true difference,
 *   measured on a second attempt, was 0.5%). Shown so it is not read as a
 *   wrong part.
 * @param {any} r A task record.
 */
function noteFor(r) {
  if (r.gradeError) return "grade error";
  if (!r.built) return r.reason ?? "";
  const g = r.grading ?? {};
  if ((g.reference_geometry_diff_fraction ?? 0) > 0.9 && r.taskScore >= 0.99) return "reference gate boolean failed";
  return g.failure_reason ?? g.failure_stage ?? "";
}

/**
 * @param {ReturnType<typeof summariseRun>} s @param {any[]} records
 * @param {ReturnType<typeof paperRows>} paper
 */
function renderMarkdown(s, records, paper) {
  const shown = paper.filter((r, i) => i < 6 || /deepseek/i.test(r.model));
  return [
    "# CAD-bench - cad-gen", "",
    s.comparable ? "All 17 public tasks graded." : `**Not comparable**: ${s.n} of 17 tasks, ${s.gradeErrors} grade errors.`,
    "", "| | Score | Easy | Medium | Hard | Insane |", "|---|---|---|---|---|---|",
    `| **cad-gen** | **${f3(s.benchmark)}** | ${f3(s.tiers.easy)} | ${f3(s.tiers.medium)} | ${f3(s.tiers.hard)} | ${f3(s.tiers.insane)} |`,
    ...shown.map((r) => `| ${r.model} (paper, standalone) | ${f3(r.score)} | ${f3(r.tiers.easy)} | ${f3(r.tiers.medium)} | ${f3(r.tiers.hard)} | ${f3(r.tiers.insane)} |`),
    "", `Built ${s.built} of ${s.n}; not built: ` + (Object.entries(s.reasons).map(([k, v]) => k + " " + v).join(", ") || "none") + ".",
    "", "## Tasks", "", "| # | Task | Tier | Built | Score | Note |", "|---|---|---|---|---|---|",
    ...[...records].sort((a, b) => a.order - b.order).map((r) =>
      `| ${r.order} | ${r.id} | ${r.difficulty} | ${r.built ? "yes" : "no"} | ${r.score === null ? "-" : f3(r.score)} | ${noteFor(r)} |`),
    "", "## Deviations", "",
    "- cad-gen writes Manifold JavaScript, not Build123D: each delivered mesh is embedded in final.py and rebuilt as one Build123D solid per body, so the grader scores cad-gen's geometry exactly but not authored Build123D code.",
    "- A part cad-gen's own gates reject is not delivered and scores zero, as the product would ship nothing.",
    "- Graded with CAD-bench's verifier image plus one pin (ocp_gordon 0.2.2): upstream, build123d no longer imports and every submission scores 0.",
    "- One sample per task; the paper's rows are its reported standalone-model runs.",
    "- Tasks marked 'reference gate boolean failed' passed every task check (task score >= 0.99) but CAD-bench's reference gate - part.cut(reference) in OCC - failed on the mesh-built solid and read it as ~100% different; the score keeps the gate's zero, as the benchmark does.",
    "", "---", "", "CAD-bench (c) its authors, MIT; tasks and verifier at commit " + CADBENCH_COMMIT + ".", "",
  ].join("\n");
}

/** Builds the pinned verifier image when it is missing. */
function ensureVerifierImage() {
  if (spawnSync("docker", ["image", "inspect", VERIFIER_IMAGE], { stdio: "ignore" }).status === 0) return;
  console.log("building the CAD-bench verifier image (first run only)...");
  const upstream = spawnSync("bash", [path.join(REPO_ROOT, "images", "build.sh")], { stdio: "inherit" });
  if (upstream.status !== 0) throw new Error("building CAD-bench's images failed");
  const overlay = spawnSync("docker", ["build", "-t", VERIFIER_IMAGE, "-f",
    path.join(PROJECT_ROOT, "scripts", "lib", "cadbench-verifier.Dockerfile"), path.join(PROJECT_ROOT, "scripts", "lib")], { stdio: "inherit" });
  if (overlay.status !== 0) throw new Error("building the pinned verifier overlay failed");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = requireEnv();
  fetchCadBench(REPO_ROOT);
  ensureVerifierImage();
  const all = loadTasks(REPO_ROOT);
  const tasks = all.filter((t) => !opts.ids || opts.ids.includes(t.id)).slice(0, opts.limit);
  const dir = opts.regrade ?? opts.resume ?? nextRunDir(opts.out);
  console.log("run directory: " + dir);
  /** @param {any} r */
  const line = (r) => r.id.padEnd(40) + (r.built ? (r.gradeError ? "grade_error" : "score " + r.score.toFixed(3)) : r.reason);

  if (opts.regrade) {
    const records = tasks.map((t) => readJson(path.join(dir, t.id + ".json"))).filter((r) => r?.built);
    console.log("regrading " + records.length + " built tasks from their saved parts");
    await pool(records, opts.concurrency, async (record) => {
      const r = await regradeTask({ record, dir, grade: gradeSubmission });
      writeJsonAtomic(path.join(dir, r.id + ".json"), r);
      console.log(line(r));
    }, () => false);
  } else {
    const kernel = createWorkerKernel();
    const generator = cadGeneratorFrom(env);
    const todo = tasks.filter((t) => !fs.existsSync(path.join(dir, t.id + ".json")));
    console.log(tasks.length + " tasks, " + todo.length + " to run");
    await pool(todo, opts.concurrency, async (task) => {
      const r = await runTask({ generator, kernel, task, dir, grade: gradeSubmission });
      writeJsonAtomic(path.join(dir, task.id + ".json"), r);
      console.log(line(r));
    }, () => false);
  }

  const records = all.map((t) => readJson(path.join(dir, t.id + ".json"))).filter(Boolean);
  const summary = summariseRun(records, all.length);
  const paper = paperRows(readJson(path.join(REPO_ROOT, "metadata", "cad-bench-reported-results.json")));
  writeJsonAtomic(path.join(dir, "summary.json"), summary);
  fs.writeFileSync(path.join(dir, "summary.md"), renderMarkdown(summary, records, paper));
  console.log(`\nCAD-bench score ${summary.benchmark.toFixed(3)} (${summary.n} tasks${summary.comparable ? "" : ", not comparable"})`);
  console.log("summary: " + path.join(dir, "summary.md"));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("HARNESS_FATAL", e);
    process.exit(1);
  });
}
