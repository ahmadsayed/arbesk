/**
 * CAD-bench's public tasks: pinned checkout, task loading, prompts, the tier-weighted score.
 * @remarks CAD-bench ("Benchmarking Language Models on Functional CAD Generation",
 *   ICML 2026; github.com/CAD-bench/cad-bench, MIT) has 17 public tasks from
 *   basic solids to threaded pairs and working gear trains, each graded by a
 *   deterministic verifier. The repository is cloned at one commit into
 *   gitignored test-results/ so the tasks and the verifier cannot drift
 *   under a score.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CADBENCH_REPO = "https://github.com/CAD-bench/cad-bench";
/** The commit every task, contract and verifier image is built from (2026-07-24). */
export const CADBENCH_COMMIT = "f1084c3d345f859ba48a4bd9d5c95bccca7dcb46";

/** dataset/metric.py's tier weights. */
export const TIER_WEIGHTS = Object.freeze({ easy: 1, medium: 2, hard: 3, insane: 4 });

/**
 * @typedef {{ id: string, difficulty: "easy" | "medium" | "hard" | "insane", weight: number,
 *   order: number, prompt: string, instruction: string }} Task
 */

/**
 * Clones the pinned CAD-bench commit into root, unless it is already there.
 * @param {string} root
 * @throws {Error} When git fails.
 */
export function fetchCadBench(root) {
  if (fs.existsSync(path.join(root, "dataset"))) return;
  fs.mkdirSync(path.dirname(root), { recursive: true });
  /** @param {string[]} args @param {string} [cwd] */
  const git = (args, cwd) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error("git " + args.join(" ") + " failed: " + r.stderr);
  };
  git(["clone", "--quiet", CADBENCH_REPO, root]);
  git(["checkout", "--quiet", CADBENCH_COMMIT], root);
}

/**
 * A task's prompt for cad-gen: the instruction without its Build123D contract.
 * @remarks The contract tells an agent to write /workspace/final.py for
 *   Build123D; cad-gen writes its own CAD code and the harness does that
 *   wrapping, so the paragraph would only mislead the generator. Everything a
 *   human designer would need - requirements, placement, the rig - stays.
 * @param {string} instruction The task's instruction.md.
 * @returns {string}
 */
export function taskPrompt(instruction) {
  const cut = instruction.search(/^Submission contract\s*$/m);
  return (cut < 0 ? instruction : instruction.slice(0, cut)).trim();
}

/**
 * @param {string} toml A task.toml.
 * @param {string} key A key of its [metadata] table.
 * @returns {string | undefined}
 */
function metadataValue(toml, key) {
  const table = toml.split(/^\[metadata\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const m = table.match(new RegExp("^" + key + "\\s*=\\s*\"?([^\"\\n]+)\"?\\s*$", "m"));
  return m?.[1].trim();
}

/**
 * Every public task, in the benchmark's order.
 * @param {string} root The CAD-bench checkout.
 * @returns {Task[]}
 */
export function loadTasks(root) {
  const dataset = path.join(root, "dataset");
  return fs.readdirSync(dataset)
    .filter((id) => fs.existsSync(path.join(dataset, id, "task.toml")))
    .map((id) => {
      const toml = fs.readFileSync(path.join(dataset, id, "task.toml"), "utf8");
      const instruction = fs.readFileSync(path.join(dataset, id, "instruction.md"), "utf8");
      return {
        id,
        difficulty: /** @type {Task["difficulty"]} */ (metadataValue(toml, "difficulty")),
        weight: Number(metadataValue(toml, "difficulty_weight")),
        order: Number(metadataValue(toml, "order")),
        prompt: taskPrompt(instruction),
        instruction,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * The benchmark score, exactly as dataset/metric.py computes it.
 * @remarks The mean overall_score within each represented tier, clamped to
 *   [0, 1], then the tier means weighted 1/2/3/4. A task with no reward counts
 *   as zero, so a crash can never improve a score.
 * @param {{ difficulty: keyof typeof TIER_WEIGHTS, score: number | null }[]} rows
 * @returns {{ benchmark: number, tiers: Record<string, number> }}
 */
export function benchmarkScore(rows) {
  /** @type {Record<string, number[]>} */
  const grouped = {};
  for (const r of rows) (grouped[r.difficulty] ??= []).push(Math.max(0, Math.min(1, r.score ?? 0)));
  /** @type {Record<string, number>} */
  const tiers = {};
  for (const tier of Object.keys(TIER_WEIGHTS)) {
    const v = grouped[tier];
    if (v?.length) tiers[tier] = v.reduce((a, b) => a + b, 0) / v.length;
  }
  const weight = Object.keys(tiers).reduce((w, t) => w + TIER_WEIGHTS[/** @type {keyof typeof TIER_WEIGHTS} */ (t)], 0);
  const benchmark = weight
    ? Object.entries(tiers).reduce((s, [t, m]) => s + m * TIER_WEIGHTS[/** @type {keyof typeof TIER_WEIGHTS} */ (t)], 0) / weight
    : 0;
  return { benchmark, tiers };
}
