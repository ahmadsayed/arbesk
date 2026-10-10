/**
 * One CAD-bench task through cad-gen's hardened loop, the bridge and the verifier.
 * @remarks The generator and the loop are MUSE's and CADPrompt's: generate,
 *   then the kernel (in a worker, under the browser's 90 s render limit), the
 *   geometric gates and the client repair rounds. A task cad-gen delivers no
 *   part for scores zero - CAD-bench counts a missing reward as zero - and is
 *   never sent to the grader; a delivered part is bridged to final.py and
 *   graded by CAD-bench's own verifier.
 */
import fs from "node:fs";
import path from "node:path";
import { CadGenerationFailed } from "../../packages/cad-gen/src/errors.ts";
import { classifyError, SAMPLE_TIMEOUT_MS } from "./bench-sample.mjs";
import { bridgeSource } from "./cadbench-bridge.mjs";
import { buildWithClientRepair } from "./client-repair.mjs";
import { writeBinaryStl } from "./stl.mjs";

/** @typedef {{ prompt: number, completion: number }} Tokens */

/** @param {Tokens} a @param {Tokens | undefined} b @returns {Tokens} */
const addTokens = (a, b) => ({ prompt: a.prompt + (b?.prompt ?? 0), completion: a.completion + (b?.completion ?? 0) });

/**
 * @param {{ generator: any, kernel: any, task: import("./cadbench.mjs").Task, dir: string,
 *   grade: (ctx: { taskId: string, dir: string }) => Promise<any>, timeoutMs?: number }} ctx
 * @returns {Promise<any>} The task record.
 */
export async function runTask(ctx) {
  const { task } = ctx;
  const taskDir = path.join(ctx.dir, task.id);
  fs.mkdirSync(taskDir, { recursive: true });
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? SAMPLE_TIMEOUT_MS);
  /** @type {any} */
  const record = {
    id: task.id, difficulty: task.difficulty, order: task.order,
    built: false, reason: null, error: null, firstPass: false, clientFailures: [], design: null, stats: null,
    score: 0, buildSuccess: 0, taskScore: 0, grading: null, gradeError: null,
    tokens: { prompt: 0, completion: 0 }, durationMs: 0,
  };
  try {
    /** @type {any} */
    let built;
    try {
      const first = await ctx.generator.generate({ prompt: task.prompt, signal: controller.signal });
      record.tokens = addTokens(record.tokens, first.diagnostics?.tokens);
      built = await buildWithClientRepair(
        { generator: ctx.generator, kernel: ctx.kernel, prompt: task.prompt, signal: controller.signal }, first);
      for (const r of built.results) record.tokens = addTokens(record.tokens, r.diagnostics?.tokens);
      record.design = built.design;
      record.clientFailures = built.failures;
    } catch (e) {
      record.reason = e instanceof Error && e.name === "RenderTimeout" ? "render_timeout" : classifyError(e, controller.signal);
      record.error = e instanceof Error ? e.message : String(e);
      if (e instanceof CadGenerationFailed) record.tokens = addTokens(record.tokens, /** @type {any} */ (e.diagnostics)?.tokens);
      return record;
    }
    if (!built.run) {
      const last = built.failures[built.failures.length - 1];
      record.reason = last.gate === "kernel" ? "kernel_error" : "gate:" + last.gate;
      record.error = last.error;
      return record;
    }
    record.built = true;
    record.firstPass = built.failures.length === 0;
    record.stats = built.run.stats;
    writeBinaryStl(path.join(taskDir, "part.stl"), built.run.mesh);
    fs.writeFileSync(path.join(taskDir, "final.py"), bridgeSource(built.run.mesh, { taskId: task.id }));
    const g = await ctx.grade({ taskId: task.id, dir: taskDir });
    if (g.gradeError) {
      record.score = null;
      record.gradeError = g.gradeError;
    } else {
      record.score = g.overall_score ?? 0;
      record.buildSuccess = g.build_success ?? 0;
      record.taskScore = g.task_score ?? 0;
      record.grading = g.grading;
    }
    return record;
  } finally {
    clearTimeout(timer);
    record.durationMs = Date.now() - started;
  }
}
