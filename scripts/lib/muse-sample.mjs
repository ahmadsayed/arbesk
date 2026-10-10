/**
 * One MUSE case through cad-gen's hardened loop, mapped onto MUSE's stages.
 * @remarks The loop is exactly CADPrompt's - generate (server static repair),
 *   then the kernel, the geometric gates and the client repair rounds - so the
 *   two benchmarks score the same generator. What differs is the outcome:
 *   MUSE's funnel has a code stage (did it execute) and a geometry stage (is
 *   it a valid solid). Manifold output is watertight, manifold and free of
 *   self-intersection by construction and its unions cannot interpenetrate, so
 *   those four checks are recorded, not re-run; a part our own gates reject
 *   fails the geometry stage, because the product would not deliver it.
 */
import fs from "node:fs";
import path from "node:path";
import { CadGenerationFailed } from "../../packages/cad-gen/src/errors.ts";
import { classifyError, SAMPLE_TIMEOUT_MS } from "./bench-sample.mjs";
import { buildWithClientRepair } from "./client-repair.mjs";
import { drawingSvg, svgToPng } from "./drawing.mjs";
import { renderMesh, writePng } from "./render.mjs";
import { writeBinaryStl } from "./stl.mjs";

/** @typedef {{ prompt: number, completion: number }} Tokens */

/** @param {Tokens} a @param {Tokens | undefined} b @returns {Tokens} */
const addTokens = (a, b) => ({ prompt: a.prompt + (b?.prompt ?? 0), completion: a.completion + (b?.completion ?? 0) });

/** The four geometry checks MUSE runs, all guaranteed by Manifold for a built part. */
const MANIFOLD_GEOMETRY = Object.freeze({ watertight: true, manifold: true, selfIntersectionFree: true, overlapFree: true });

/**
 * Draws the sheet for a delivered part: SVG, then PNG through inkscape.
 * @param {any} mesh @param {{ svg: string, png: string, title: string }} files
 */
function drawSheet(mesh, files) {
  fs.writeFileSync(files.svg, drawingSvg(mesh, { title: files.title, date: new Date().toISOString().slice(0, 10) }));
  svgToPng(files.svg, files.png);
}

/**
 * Runs one case.
 * @param {{ generator: any, kernel: any, kase: import("./muse.mjs").Case, dir: string,
 *   timeoutMs?: number, draw?: boolean,
 *   drawImpl?: (mesh: any, files: { svg: string, png: string, title: string }) => void | Promise<void> }} ctx
 *   drawImpl draws the sheet - the CLI passes the worker kernel's draw, which
 *   has the render time limit; tests inject failures through it.
 * @returns {Promise<any>} The case record.
 */
export async function runCase(ctx) {
  const { kase } = ctx;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? SAMPLE_TIMEOUT_MS);
  /** @type {any} */
  const record = {
    id: kase.id, strata: kase.strata,
    stage1: false, stage1Reason: null, stage2: false, stage2Reason: null, geometry: null,
    firstPass: false, clientFailures: [], error: null, design: null, diagnostics: null, stats: null,
    drawing: null, drawingError: null,
    tokens: { prompt: 0, completion: 0 }, jevTokens: { prompt: 0, completion: 0 }, durationMs: 0,
  };
  try {
    /** @type {any} */
    let built;
    try {
      const first = await ctx.generator.generate({ prompt: kase.spec, signal: controller.signal });
      record.diagnostics = first.diagnostics;
      record.tokens = addTokens(record.tokens, first.diagnostics?.tokens);
      record.jevTokens = addTokens(record.jevTokens, first.diagnostics?.selection?.jevTokens);
      built = await buildWithClientRepair(
        { generator: ctx.generator, kernel: ctx.kernel, prompt: kase.spec, signal: controller.signal }, first);
      for (const r of built.results) record.tokens = addTokens(record.tokens, r.diagnostics?.tokens);
      record.design = built.design;
      record.clientFailures = built.failures;
    } catch (e) {
      // A build past the browser's 90 s limit is what a user would see fail.
      record.stage1Reason = e instanceof Error && e.name === "RenderTimeout" ? "render_timeout" : classifyError(e, controller.signal);
      record.error = e instanceof Error ? e.message : String(e);
      if (e instanceof CadGenerationFailed) {
        record.tokens = addTokens(record.tokens, /** @type {any} */ (e.diagnostics)?.tokens);
      }
      return record;
    }
    if (!built.run) {
      const last = built.failures[built.failures.length - 1];
      record.error = last.error;
      if (last.gate === "kernel") {
        record.stage1Reason = "kernel_error";
      } else {
        record.stage1 = true;
        record.geometry = MANIFOLD_GEOMETRY;
        record.stage2Reason = "gate:" + last.gate;
      }
      return record;
    }
    record.stage1 = true;
    record.stage2 = true;
    record.geometry = MANIFOLD_GEOMETRY;
    record.firstPass = built.failures.length === 0;
    record.stats = built.run.stats;
    if (ctx.draw !== false) await writeArtifacts(ctx, record, built.run.mesh);
    return record;
  } finally {
    clearTimeout(timer);
    record.durationMs = Date.now() - started;
  }
}

/**
 * Writes the delivered part's STL, sheet and shaded render.
 * @remarks A drawing failure is recorded, never thrown: the part was built,
 *   and the summary reports undrawable parts apart from judged ones.
 * @param {any} ctx @param {any} record @param {any} mesh
 * @returns {Promise<void>}
 */
async function writeArtifacts(ctx, record, mesh) {
  const stem = path.join(ctx.dir, record.id);
  writeBinaryStl(stem + ".stl", mesh);
  const image = renderMesh(mesh, { width: 720, height: 560 });
  writePng(stem + ".render.png", image.width, image.height, image.rgb);
  try {
    await (ctx.drawImpl ?? drawSheet)(mesh, { svg: stem + ".drawing.svg", png: stem + ".drawing.png", title: record.id });
    record.drawing = "ok";
  } catch (e) {
    record.drawing = "error";
    record.drawingError = e instanceof Error ? e.message : String(e);
  }
}
