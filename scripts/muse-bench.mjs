/**
 * MUSE text-to-CAD benchmark for @arbesk/cad-gen.
 *
 * Runs each MUSE case (Dong, Li & Wu, arXiv 2605.28579; 106 cases, CC BY 4.0)
 * through cad-gen's hardened loop, draws every delivered part as a MUSE-style
 * engineering sheet, has MUSE's own judge (Gemini-3.1-Pro, MUSE's prompt and
 * rubric) score it, and writes the paper's funnel beside its leaderboard. The
 * design is docs/superpowers/specs/2026-10-10-muse-bench-design.md.
 *
 * Usage:
 *   bun scripts/muse-bench.mjs [--limit N] [--ids a,b,c] [--method cnc|print|laser]
 *                              [--concurrency 4] [--no-judge]
 *                              [--resume <runDir>] [--judge-only <runDir>]
 *                              [--out test-results/muse-bench]
 *
 * Keys: DEEPSEEK_API_KEY (and the Jev settings) from .env, exactly as for
 * cad-bench; GEMINI_API_KEY from .env.gemini, falling back to .env. Every run
 * costs DeepSeek and Gemini calls - this is not a CI job.
 */
import fs from "node:fs";
import path from "node:path";
import { nextRunDir, pool, readJson, writeJsonAtomic } from "./lib/bench-io.mjs";
import { PROJECT_ROOT, cadGeneratorFrom, loadEnv, requireEnv } from "./lib/cad-harness.mjs";
import { createWorkerKernel } from "./lib/kernel-worker.mjs";
import { fetchMuse, loadCases, MUSE_REVISION } from "./lib/muse.mjs";
import { JUDGE_MODEL, JudgeAbort, judgeCase } from "./lib/muse-judge.mjs";
import { runCase } from "./lib/muse-sample.mjs";
import { summarise, writeReport } from "./lib/muse-summary.mjs";

const DEFAULT_OUT = path.join(PROJECT_ROOT, "test-results", "muse-bench");
const DATA_ROOT = path.join(PROJECT_ROOT, "test-results", "muse");
const DEFAULT_CONCURRENCY = 4;

/** DeepSeek failing this many cases in a row means the provider is down, not the cases. */
const MAX_CONSECUTIVE_PROVIDER_ERRORS = 3;

const METHODS = ["cnc", "print", "laser"];

/**
 * @param {string[]} argv Arguments after the script path.
 */
export function parseArgs(argv) {
  const opts = {
    limit: Infinity, ids: /** @type {string[] | null} */ (null), method: /** @type {string | null} */ (null),
    concurrency: DEFAULT_CONCURRENCY, judge: true,
    resume: /** @type {string | null} */ (null), judgeOnly: /** @type {string | null} */ (null),
    out: DEFAULT_OUT, filtered: false,
  };
  /** @param {string} flag @param {string} raw */
  const positive = (flag, raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(flag + " must be a positive integer, got " + raw);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(flag + " needs a value");
      return v;
    };
    switch (flag) {
      case "--limit": opts.limit = positive(flag, value()); break;
      case "--concurrency": opts.concurrency = positive(flag, value()); break;
      case "--ids": {
        const ids = value().split(",").map((s) => s.trim()).filter(Boolean);
        if (!ids.length) throw new Error("--ids must be a comma-separated list of case ids");
        opts.ids = ids;
        break;
      }
      case "--method": {
        const m = value();
        if (!METHODS.includes(m)) throw new Error("--method must be one of " + METHODS.join(", ") + ", got " + m);
        opts.method = m;
        break;
      }
      case "--no-judge": opts.judge = false; break;
      case "--resume": opts.resume = path.resolve(value()); break;
      case "--judge-only": opts.judgeOnly = path.resolve(value()); break;
      case "--out": opts.out = path.resolve(value()); break;
      default: throw new Error("unknown argument " + flag);
    }
  }
  if (opts.judgeOnly && (!opts.judge || opts.resume)) {
    throw new Error("--judge-only contradicts --no-judge and --resume");
  }
  opts.filtered = opts.limit !== Infinity || opts.ids !== null || opts.method !== null;
  return opts;
}

/**
 * The cases this invocation covers.
 * @param {import("./lib/muse.mjs").Case[]} all @param {ReturnType<typeof parseArgs>} opts
 */
function selectCases(all, opts) {
  let cases = all;
  if (opts.ids) {
    const unknown = opts.ids.filter((id) => !all.some((c) => c.id === id));
    if (unknown.length) throw new Error("unknown MUSE case ids: " + unknown.join(", "));
    cases = cases.filter((c) => opts.ids?.includes(c.id));
  }
  if (opts.method) cases = cases.filter((c) => c.strata.method === opts.method);
  return cases.slice(0, opts.limit);
}

/** @param {string} dir @param {string} id */
const recordFile = (dir, id) => path.join(dir, id + ".json");
/** @param {string} dir @param {string} id */
const scoreFile = (dir, id) => path.join(dir, id + ".score.json");

/**
 * Judges one built case and writes its score.
 * @param {string} dir @param {import("./lib/muse.mjs").Case} kase @param {string} apiKey
 */
async function judgeAndRecord(dir, kase, apiKey) {
  const score = await judgeCase({ apiKey, kase, generatedPngFile: path.join(dir, kase.id + ".drawing.png") });
  writeJsonAtomic(scoreFile(dir, kase.id), score);
  return score;
}

/** @param {any} record */
const judgeable = (record) => record?.stage2 && record.drawing === "ok";

/**
 * Rebuilds the summary from what the run directory holds.
 * @remarks From the directory, never from this invocation: a --resume or a
 *   --judge-only must not relabel the run (cad-bench learned this the hard way).
 * @param {string} dir @param {import("./lib/muse.mjs").Case[]} all
 */
function summariseDir(dir, all) {
  const meta = readJson(path.join(dir, "run.json")) ?? {};
  const cases = all.map((k) => {
    const r = readJson(recordFile(dir, k.id));
    return r ? { ...r, referencePng: k.referencePng } : null;
  }).filter(Boolean);
  /** @type {Map<string, any>} */
  const scores = new Map();
  for (const c of cases) {
    const s = readJson(scoreFile(dir, c.id));
    if (s) scores.set(c.id, s);
  }
  const summary = summarise(cases, scores, { filtered: Boolean(meta.filtered) });
  writeReport(dir, summary, cases, scores);
  return summary;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = requireEnv();
  const apiKey = loadEnv(path.join(PROJECT_ROOT, ".env.gemini")).GEMINI_API_KEY || env.GEMINI_API_KEY;
  if (opts.judge && !apiKey) {
    console.error("GEMINI_API_KEY missing: put it in .env.gemini (or .env), or run with --no-judge");
    process.exit(2);
  }

  await fetchMuse(DATA_ROOT);
  const all = loadCases(DATA_ROOT);
  const cases = selectCases(all, opts);
  const dir = opts.judgeOnly ?? opts.resume ?? nextRunDir(opts.out);
  if (!opts.resume && !opts.judgeOnly) {
    writeJsonAtomic(path.join(dir, "run.json"), {
      created: new Date().toISOString(), filtered: opts.filtered, judge: opts.judge ? JUDGE_MODEL : null,
      dataset: MUSE_REVISION, cases: cases.map((c) => c.id),
    });
  }
  console.log("run directory: " + dir);

  let aborted = false;
  let providerErrors = 0;
  /** @param {unknown} e */
  const stopOnJudgeAbort = (e) => {
    if (!(e instanceof JudgeAbort)) throw e;
    console.error("\n" + e.message);
    aborted = true;
  };

  if (opts.judgeOnly) {
    const todo = cases.filter((k) => {
      const score = readJson(scoreFile(dir, k.id));
      return judgeable(readJson(recordFile(dir, k.id))) && (!score || score.judgeError);
    });
    console.log("judging " + todo.length + " cases");
    await pool(todo, opts.concurrency, async (kase) => {
      try {
        const s = await judgeAndRecord(dir, kase, /** @type {string} */ (apiKey));
        console.log(kase.id.padEnd(36) + (s.judgeError ? "judge_error " + s.judgeError : "score " + (s.score * 100).toFixed(1) + "%"));
      } catch (e) {
        stopOnJudgeAbort(e);
      }
    }, () => aborted);
  } else {
    // Builds and drawings run in worker threads under the browser's 90 s render
    // limit: one runaway part once froze every pool slot for over two hours.
    const kernel = createWorkerKernel();
    const generator = cadGeneratorFrom(env);
    const todo = cases.filter((k) => !fs.existsSync(recordFile(dir, k.id)));
    console.log(cases.length + " cases, " + todo.length + " to run");
    await pool(todo, opts.concurrency, async (kase) => {
      const record = await runCase({ generator, kernel, kase, dir, drawImpl: kernel.draw });
      writeJsonAtomic(recordFile(dir, kase.id), record);
      providerErrors = record.stage1Reason === "provider_error" ? providerErrors + 1 : 0;
      if (providerErrors >= MAX_CONSECUTIVE_PROVIDER_ERRORS) {
        console.error("\n" + MAX_CONSECUTIVE_PROVIDER_ERRORS + " provider errors in a row - stopping; continue with --resume " + dir);
        aborted = true;
      }
      let line = kase.id.padEnd(36) + (record.stage2 ? "built" : !record.stage1 ? record.stage1Reason : record.stage2Reason);
      if (opts.judge && judgeable(record) && !aborted) {
        try {
          const s = await judgeAndRecord(dir, kase, /** @type {string} */ (apiKey));
          line += s.judgeError ? "  judge_error" : "  score " + (s.score * 100).toFixed(1) + "%";
        } catch (e) {
          stopOnJudgeAbort(e);
        }
      }
      if (record.drawing === "error") line += "  drawing_error";
      console.log(line);
    }, () => aborted);
  }

  const s = summariseDir(dir, all);
  const h = s.headline;
  console.log(`\ncode ${h.code.toFixed(1)}% -> geometry ${h.geometry.toFixed(1)}% -> final ${h.final.toFixed(1)}%  (${h.n} cases`
    + (s.leaderboardComparable ? ", leaderboard-comparable)" : ", not leaderboard-comparable)"));
  console.log("summary: " + path.join(dir, "summary.md"));
  console.log("report:  " + path.join(dir, "index.html"));
  if (aborted) process.exit(1);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("HARNESS_FATAL", e);
    process.exit(1);
  });
}
