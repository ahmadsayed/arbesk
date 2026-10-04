/**
 * CADPrompt external benchmark for @arbesk/cad-gen.
 *
 * NOT part of the server. Runs the public CADPrompt benchmark (Alrashedy et
 * al., ICLR 2025: 200 text prompts with ground-truth meshes) through the
 * shipped loop - generate(), then the browser worker's kernel + gates + client
 * repair - and scores every part against ground truth with the paper's
 * metrics plus exact IoU. Failed and low-scoring samples are triaged by Jev
 * into a "where to improve" table, and records an observe-only Jev complexity
 * score per sample. Spec:
 * docs/superpowers/specs/2026-10-04-cad-bench-cadprompt-design.md
 *
 * Usage:
 *   bun scripts/cad-bench.mjs [--variant measured|abstract|both] [--limit N] [--ids 7,633]
 *                             [--concurrency 4] [--thinking on|off] [--no-jev] [--no-triage]
 *                             [--resume <runDir>] [--compare <runDir>] [--out <root>]
 *   bun scripts/cad-bench.mjs --agreement <runDir>   score a hand-labelled triage-agreement.md
 *
 * Reads DEEPSEEK_API_KEY (required) and JEV_API_KEY (optional) from the
 * project .env. Each run gets test-results/cad-bench/run#N/<variant>/ (gitignored).
 * The CADPrompt repository has no licence: it is fetched into test-results/
 * for local evaluation only - never commit it.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, generatorConfigFrom, loadCadKernel, requireEnv } from "./lib/cad-harness.mjs";
import { CADPROMPT_PIN, fetchCadPrompt, loadSamples } from "./lib/cadprompt.mjs";
import { runSample } from "./lib/bench-sample.mjs";
import { createScorer } from "./lib/bench-iou.mjs";
import { needsTriage, triage } from "./lib/bench-triage.mjs";
import { askComplexity } from "./lib/bench-complexity.mjs";
import {
  agreementTemplate, compareSummaries, parseAgreement, renderMarkdown, summarise,
} from "./lib/bench-summary.mjs";
import { writeBinaryStl } from "./lib/stl.mjs";
import { createCadGenerator, DEFAULT_CAD_MODEL } from "../packages/cad-gen/src/backend/index.ts";

const DEFAULT_OUT = path.join(PROJECT_ROOT, "test-results", "cad-bench");

/** Consecutive provider errors that abort a run: likely a key or quota problem. */
const MAX_CONSECUTIVE_PROVIDER_ERRORS = 3;

/**
 * @param {string[]} argv Arguments after the script path.
 */
export function parseArgs(argv) {
  const opts = {
    variants: /** @type {("measured" | "abstract")[]} */ (["measured"]),
    limit: Infinity, ids: /** @type {string[] | null} */ (null), concurrency: 4,
    jev: true, triage: true, thinking: /** @type {"on" | "off" | null} */ (null),
    resume: /** @type {string | null} */ (null), compare: /** @type {string | null} */ (null),
    agreement: /** @type {string | null} */ (null), out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(flag + " needs a value");
      return v;
    };
    switch (flag) {
      case "--variant": {
        const v = value();
        if (!["measured", "abstract", "both"].includes(v)) throw new Error("--variant must be measured, abstract or both");
        opts.variants = v === "both" ? ["measured", "abstract"] : [/** @type {"measured" | "abstract"} */ (v)];
        break;
      }
      case "--limit": {
        const raw = value();
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a positive integer, got " + raw);
        opts.limit = n;
        break;
      }
      case "--ids": {
        const raw = value().split(",").map((s) => s.trim());
        if (!raw.length || raw.some((s) => !/^\d{1,8}$/.test(s))) {
          throw new Error("--ids must be a comma-separated list of numeric prompt ids");
        }
        opts.ids = raw.map((s) => s.padStart(8, "0"));
        break;
      }
      case "--concurrency": {
        const raw = value();
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) throw new Error("--concurrency must be a positive integer, got " + raw);
        opts.concurrency = n;
        break;
      }
      case "--no-jev": opts.jev = false; break;
      case "--thinking": {
        const v = value();
        if (v !== "on" && v !== "off") throw new Error("--thinking must be on or off, got " + v);
        opts.thinking = v;
        break;
      }
      case "--no-triage": opts.triage = false; break;
      case "--resume": opts.resume = path.resolve(value()); break;
      case "--compare": opts.compare = path.resolve(value()); break;
      case "--agreement": opts.agreement = path.resolve(value()); break;
      case "--out": opts.out = path.resolve(value()); break;
      default: throw new Error("unknown argument " + flag);
    }
  }
  return opts;
}

/**
 * Runs fn over items with at most `concurrency` in flight.
 * @remarks The kernel runs synchronously in process, so concurrency overlaps
 *   provider latency, not geometry.
 * @template T
 * @param {T[]} items @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn @param {() => boolean} shouldStop
 */
export async function pool(items, concurrency, fn, shouldStop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * Creates the next free run#N directory, like cad-eval's attempt#N.
 * @param {string} root
 * @returns {string}
 */
function nextRunDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const taken = new Set(fs.readdirSync(root));
  let n = 1;
  while (taken.has("run#" + n)) n++;
  const dir = path.join(root, "run#" + n);
  fs.mkdirSync(dir);
  return dir;
}

/**
 * Writes JSON via a temp file and rename, so an interrupted run never leaves a
 * half-written result that --resume would then skip.
 * @param {string} file @param {unknown} value
 */
function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** @param {string} file @returns {any} */
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

/**
 * Every sample result written in a variant directory, in id order.
 * @remarks The summary must describe the DIRECTORY, not the current
 *   invocation's selection: a --resume with different --ids/--limit/--thinking
 *   would otherwise relabel results produced under other flags, and the
 *   per-sample file is the only record of what was actually run.
 * @param {string} dir
 * @returns {any[]}
 */
export function readResults(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{8}\.json$/.test(f)).sort()
    .map((f) => readJson(path.join(dir, f))).filter(Boolean);
}

/**
 * How many distinct run stamps a result set carries.
 * @remarks More than one means the directory mixes configurations (a resume
 *   with changed flags, or a changed .env), so the summary says so instead of
 *   presenting the mixture as a single run.
 * @param {any[]} results
 * @returns {number}
 */
export function distinctRunStamps(results) {
  return new Set(results.map((r) => JSON.stringify(r.run ?? null))).size;
}

/**
 * Writes summary.json, summary.md and (first time only) triage-agreement.md.
 * @param {string} dir Variant directory.
 * @param {any[]} results @param {any} config @param {string | null} compareRun
 */
function writeSummary(dir, results, config, compareRun) {
  const summary = summarise(results, config);
  const previous = readJson(path.join(dir, "summary.json"));
  if (previous?.triageAgreement) summary.triageAgreement = previous.triageAgreement;
  const other = compareRun ? readJson(path.join(compareRun, config.variant, "summary.json")) : null;
  if (compareRun && !other) console.warn("no " + config.variant + " summary in " + compareRun + " to compare with");
  const compare = other ? compareSummaries(summary, other) : null;
  writeJsonAtomic(path.join(dir, "summary.json"), { ...summary, compare });
  fs.writeFileSync(path.join(dir, "summary.md"), renderMarkdown(summary, { compare }));
  const sheet = path.join(dir, "triage-agreement.md");
  if (summary.triage.triaged > 0 && !fs.existsSync(sheet)) fs.writeFileSync(sheet, agreementTemplate(results));
  console.log("summary: " + path.join(dir, "summary.md"));
}

/**
 * --agreement: score hand labels and re-render each variant's summary.
 * @param {string} runDir
 */
function recordAgreement(runDir) {
  for (const variant of ["measured", "abstract"]) {
    const dir = path.join(runDir, variant);
    const sheet = path.join(dir, "triage-agreement.md");
    const summary = readJson(path.join(dir, "summary.json"));
    if (!summary || !fs.existsSync(sheet)) continue;
    summary.triageAgreement = parseAgreement(fs.readFileSync(sheet, "utf8"));
    writeJsonAtomic(path.join(dir, "summary.json"), summary);
    fs.writeFileSync(path.join(dir, "summary.md"), renderMarkdown(summary, { compare: summary.compare ?? null }));
    console.log(variant + ": agreement " + JSON.stringify(summary.triageAgreement));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.agreement) return recordAgreement(opts.agreement);
  const env = requireEnv();
  // --thinking overrides CAD_THINKING for this run only. The harness reads
  // .env, not process.env, so a shell variable would never reach the reader.
  if (opts.thinking) env.CAD_THINKING = opts.thinking === "on" ? "true" : "false";
  if (!env.JEV_API_KEY && (opts.jev || opts.triage)) {
    console.warn("JEV_API_KEY missing from .env: running as --no-jev --no-triage");
    opts.jev = false;
    opts.triage = false;
  }
  const dataset = fetchCadPrompt();
  const runDir = opts.resume ?? nextRunDir(opts.out);
  console.log("run directory: " + runDir);
  const { module, kernel } = await loadCadKernel();
  // The exact generator config the API route builds - one shared reader, so
  // the benchmark scores what production runs. Jev is stripped for --no-jev.
  const cfg = generatorConfigFrom(opts.jev ? env : { ...env, JEV_API_KEY: "" });
  const generator = createCadGenerator(cfg);
  // The complexity score describes the REQUEST, so it is asked whenever a Jev
  // key exists: --no-jev only blanks the key for the generator, and
  // --no-triage only skips the failure triage.
  // One Jev config for both observe-only asks - the failure triage and the
  // complexity score - so JEV_BASE_URL/JEV_MODEL apply to both and the echoed
  // jevModel names the model that actually answered.
  const jevCfg = generatorConfigFrom(env).jev ?? null;
  const complexityJev = env.JEV_API_KEY ? jevCfg : null;
  const score = createScorer(module);
  const jev = opts.triage ? jevCfg : null;
  const config = {
    dataset: CADPROMPT_PIN, model: cfg.model ?? DEFAULT_CAD_MODEL, thinking: cfg.thinking,
    maxRepairAttempts: cfg.limits.maxRepairAttempts, jevModel: (jevCfg ?? cfg.jev)?.model ?? "jev-latest",
    jev: opts.jev, triage: opts.triage, complexity: Boolean(complexityJev), samples: 8192, seed: 1,
  };

  const runStamp = {
    model: config.model, thinking: config.thinking, maxRepairAttempts: config.maxRepairAttempts,
    jevModel: config.jevModel, jev: opts.jev, triage: opts.triage,
  };

  for (const variant of opts.variants) {
    const dir = path.join(runDir, variant);
    fs.mkdirSync(dir, { recursive: true });
    let samples = loadSamples(dataset, variant);
    if (samples.length !== 200) {
      console.warn("WARNING: the pinned dataset yielded " + samples.length + " " + variant +
        " samples, not 200 - the paper comparison assumes the full set.");
    }
    if (opts.ids) samples = samples.filter((s) => opts.ids?.includes(s.id));
    samples = samples.slice(0, opts.limit);
    const todo = samples.filter((s) => !fs.existsSync(path.join(dir, s.id + ".json")));
    console.log("\n" + variant + ": " + samples.length + " samples, " + todo.length + " to run");

    let consecutive = 0, aborted = false;
    await pool(todo, opts.concurrency, async (sample) => {
      const { result, mesh } = await runSample({ generator, kernel, score, sample });
      if (mesh) writeBinaryStl(path.join(dir, sample.id + ".stl"), mesh);
      // Asked AFTER the sample so failures get a band too: the table must
      // describe the requests, not only the parts that built.
      if (complexityJev) result.complexity = await askComplexity(complexityJev, result.prompt);
      result.run = runStamp;
      if (jev && needsTriage(result)) result.triage = await triage(jev, result);
      writeJsonAtomic(path.join(dir, sample.id + ".json"), result);
      consecutive = result.outcome === "provider_error" ? consecutive + 1 : 0;
      if (consecutive >= MAX_CONSECUTIVE_PROVIDER_ERRORS) aborted = true;
      const m = result.metrics;
      console.log(sample.id + "  " + result.outcome.padEnd(14) + " iou " + (m.iou ?? NaN).toFixed(3) +
        "  iogt " + m.iogt.toFixed(3) + "  cd " + m.chamfer.toFixed(3) +
        (result.triage?.failureCause ? "  -> " + result.triage.failureCause.label : "") +
        (result.triage?.shapeMismatch ? "  -> " + result.triage.shapeMismatch.label : ""));
    }, () => aborted);

    if (aborted) {
      console.error("aborting: " + MAX_CONSECUTIVE_PROVIDER_ERRORS + " consecutive provider errors " +
        "(key or quota?). Continue with --resume " + runDir);
      process.exitCode = 1;
    }
    const results = readResults(dir);
    const stamps = distinctRunStamps(results);
    if (stamps > 1) {
      console.warn("WARNING: " + dir + " holds results from " + stamps + " run configurations " +
        "(a resume with changed flags, or a changed .env); the summary mixes them.");
    }
    writeSummary(dir, results, { ...config, variant, mixedRuns: stamps > 1 }, opts.compare);
    if (aborted) return;
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("HARNESS_FATAL", e);
    process.exit(1);
  });
}
