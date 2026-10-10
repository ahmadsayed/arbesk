/**
 * Offline evaluation harness for @arbesk/cad-gen.
 *
 * NOT part of the server. The server never runs the kernel - it generates code
 * and runs the static gates, and the client executes. This harness exists so a
 * design can be generated against the live provider, built, measured and
 * RENDERED for a human to look at. That loop is how the guard false-positive on
 * comment prose, the silently-empty hand-built fillet, and the concave-Minkowski
 * blowup were all found; none of them were visible to a passing unit test.
 *
 * Usage:
 *   bun scripts/cad-eval.mjs "<prompt>" ["<prompt>" ...]
 *   bun scripts/cad-eval.mjs --file <scenarios.json>
 *   ... [--out <dir>]        (default: test-results/cad-eval, which is gitignored)
 *
 * Each run gets its OWN numbered directory inside the output root -
 * <root>/attempt#1, <root>/attempt#2, ... - so a gallery accumulates as the
 * prelude, the prompt and the fidelity settings change, and a later attempt can
 * be compared against an earlier one instead of overwriting it. The run prints
 * the directory it wrote to; open it and look at the PNGs.
 *
 * Reads DEEPSEEK_API_KEY from the project .env. Runs the kernel IN PROCESS with
 * no wall-clock cap, so a pathological part will simply take a long time: this
 * is a tool for looking at output, not a service.
 */
import fs from "node:fs";
import path from "node:path";
import { buildPrelude, PRELUDE_NAMES } from "../packages/cad-gen/src/core/prelude.ts";
import { meshToGlb, meshTo3mf } from "../packages/cad-gen/src/core/export/index.ts";
import { DEGENERATE_BODY_MM3, meshFrom } from "../packages/cad-gen/src/core/kernel.ts";
import { bodyFloor } from "../packages/cad-gen/src/core/gates.ts";
import { buildWithClientRepair } from "./lib/client-repair.mjs";
import { readStl } from "./lib/stl.mjs";
import { boundsOf, renderMesh, writePng } from "./lib/render.mjs";
import { PROJECT_ROOT, cadGeneratorFrom, loadCadKernel, loadEnv } from "./lib/cad-harness.mjs";

/** @typedef {{ positions: Float32Array, indices: Uint32Array }} Mesh */
/** @typedef {{ width?: number, height?: number, dir?: number[], tint?: number[],
 *   frame?: { centre: number[], extent: number } }} RenderOptions */


// ---------------------------------------------------------------- environment

/**
 * Parses a .env file into a plain record.
 * @param {string} file Absolute path to the env file.
 * @returns {Record<string, string>} Key/value pairs, quotes stripped.
 */
// ----------------------------------------------------------------- components

/** Distinct tints, so a body that is not joined to the rest is obvious. */
const TINTS = [
  [214, 219, 228],
  [232, 158, 138],
  [140, 198, 162],
  [206, 170, 228],
  [238, 212, 140],
];

/**
 * Splits a design into its connected solids and tints each one.
 * @remarks A render shows SURFACES, not connectivity: two bodies a tenth of a
 *   millimetre apart are pixel-identical to two bodies welded together, so the
 *   eye cannot separate a joined part from a detached one. Counting the
 *   components and colouring them differently is what makes the difference
 *   visible - Manifold.decompose() is exact where the eye is not. Live evidence:
 *   a timing pulley whose teeth floated 0.75mm clear of the body rendered as
 *   "loose bars" that I had to read the code to explain, and a blind bore that
 *   was invisible from every angle.
 * @param {any} module A loaded manifold-3d module.
 * @param {any} design The design document.
 * @returns {{ solids: number, meshes: Mesh[], tints: number[][] }} What to draw.
 */
function componentsOf(module, design) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const [k, v] of Object.entries(design.parameters)) values[k] = /** @type {any} */ (v).value;
  const fn = new Function("PARAMETERS", "P", "M", ...PRELUDE_NAMES, design.code);
  const helpers = buildPrelude(module, { segments: 64 });
  const part = fn(values, values, module.Manifold, ...PRELUDE_NAMES.map((n) => helpers[n]));
  // Same rule as the kernel: a zero-volume flake is not a body.
  const solids = part.decompose().filter((/** @type {any} */ s) => Math.abs(s.volume()) >= DEGENERATE_BODY_MM3);
  return {
    solids: solids.length,
    meshes: solids.map((/** @type {any} */ s) => meshFrom(s.getMesh())),
    tints: solids.map((/** @type {any} */ _s, /** @type {number} */ i) => TINTS[i % TINTS.length]),
  };
}

/**
 * Draws every component into one image, each in its own tint.
 * @param {string} file Destination PNG.
 * @param {Mesh[]} meshes Component meshes, all in the same world frame.
 * @param {number[][]} tints One tint per mesh.
 * @param {RenderOptions} opts Size and view direction.
 * @returns {number} Bytes written.
 */
function renderComponents(file, meshes, tints, opts) {
  const boxes = meshes.map((m) => boundsOf(m));
  const centre = [0, 1, 2].map((a) =>
    (Math.min(...boxes.map((b) => b.min[a])) + Math.max(...boxes.map((b) => b.max[a]))) / 2);
  const extent = Math.max(...boxes.flatMap((b) =>
    [0, 1, 2].map((a) => Math.max(Math.abs(b.min[a] - centre[a]), Math.abs(b.max[a] - centre[a])))));
  const layers = meshes.map((mesh, i) =>
    renderMesh(mesh, { ...opts, tint: tints[i], frame: { centre, extent } }));
  const width = layers[0].width;
  const height = layers[0].height;
  const out = Buffer.alloc(width * height * 3);
  // Paint furthest-component-first so a small piece is never hidden behind a
  // large one: a loose standoff must not be occluded by the box it fell off.
  const order = meshes.map((m, i) => ({ i, size: m.indices.length })).sort((a, b) => b.size - a.size);
  for (const { i } of order) {
    const rgb = layers[i].rgb;
    for (let p = 0; p < out.length; p += 3) {
      if (rgb[p] !== 20 || rgb[p + 1] !== 22 || rgb[p + 2] !== 27) {
        out[p] = rgb[p];
        out[p + 1] = rgb[p + 1];
        out[p + 2] = rgb[p + 2];
      }
    }
  }
  for (let p = 0; p < out.length; p += 3) {
    if (out[p] === 0 && out[p + 1] === 0 && out[p + 2] === 0) {
      out[p] = 20;
      out[p + 1] = 22;
      out[p + 2] = 27;
    }
  }
  return writePng(file, width, height, out);
}

// ----------------------------------------------------------------- GLB / 3MF

// Export goes through the SHARED core exporters, not a local writer. This file
// used to carry its own 40-line GLB encoder, which is precisely the drift the
// shared core exists to prevent: it wrote no normals, no design sidecar, and
// nothing tied it to the code the browser worker will run. meshToGlb and
// meshTo3mf are the same two functions the client calls, so a file this harness
// produces is byte-comparable with one the client produces.

/**
 * Writes a mesh as GLB and 3MF, design document embedded in both.
 * @param {string} stem Destination path without extension.
 * @param {Mesh} mesh Mesh in millimetres, Z-up.
 * @param {any} design The design document that produced the mesh.
 * @returns {{ glb: number, threeMf: number }} Bytes written for each format.
 */
function writeExports(stem, mesh, design) {
  const glb = meshToGlb(mesh, design);
  const threeMf = meshTo3mf(mesh, design);
  fs.writeFileSync(stem + ".glb", glb);
  fs.writeFileSync(stem + ".3mf", threeMf);
  return { glb: glb.length, threeMf: threeMf.length };
}

// ---------------------------------------------------------------------- main

/** Where renders land when the caller does not name a directory. */
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, "test-results", "cad-eval");

/**
 * Creates and returns the next free `attempt#N` directory under `root`.
 * @remarks Never reuses a number, so an earlier attempt stays on disk to compare
 *   against. The counter is derived from what is already there rather than kept
 *   in a file, so deleting a gallery resets it and nothing can drift.
 * @param {string} root Gallery root, created if absent.
 * @returns {string} Absolute path to the freshly created run directory.
 */
function nextAttemptDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const taken = new Set(fs.readdirSync(root));
  for (let n = 1; ; n++) {
    const name = "attempt#" + n;
    if (taken.has(name)) continue;
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    return dir;
  }
}

/**
 * Splits `--out <dir>` out of argv.
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ outDir: string, rest: string[] }} Output directory and the rest.
 */
function parseArgs(argv) {
  const at = argv.indexOf("--out");
  if (at === -1) return { outDir: DEFAULT_OUT_DIR, rest: argv };
  const named = argv[at + 1];
  return {
    outDir: named && !named.startsWith("--") ? path.resolve(named) : DEFAULT_OUT_DIR,
    rest: [...argv.slice(0, at), ...argv.slice(at + 2)],
  };
}

/**
 * Resolves the scenario list from argv.
 * @param {string[]} argv Arguments after the output directory.
 * @returns {{ name: string, prompt: string }[]} Scenarios to run.
 */
function scenariosFrom(argv) {
  if (argv[0] === "--file") {
    return JSON.parse(fs.readFileSync(argv[1], "utf8"));
  }
  return argv.map((prompt, i) => ({ name: "q" + (i + 1), prompt }));
}

/**
 * @param {string} name Scenario name, used as the file stem.
 * @returns {string} A filesystem-safe slug.
 */
const slug = (name) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

async function main() {
  const { outDir, rest } = parseArgs(process.argv.slice(2));
  // Reference mode: render a known-good STL through our own renderer so a
  // comparison is of two PARTS, not of two different pictures.
  if (rest[0] === "--stl") {
    const mesh = readStl(rest[1]);
    const stats = boundsOf(mesh);
    const target = rest[2] ?? path.join(outDir, path.basename(rest[1]).replace(/\.stl$/i, ".png"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writePng(target, ...(() => {
      const image = renderMesh(mesh, { width: 720, height: 560 });
      return /** @type {[number, number, Buffer]} */ ([image.width, image.height, image.rgb]);
    })());
    console.log("reference " + rest[1]);
    console.log("  triangles " + mesh.indices.length / 3);
    console.log("  size mm   " + [0, 1, 2].map((a) => (stats.max[a] - stats.min[a]).toFixed(2)).join(" x "));
    console.log("  centre mm " + [0, 1, 2].map((a) => ((stats.min[a] + stats.max[a]) / 2).toFixed(2)).join(", "));
    console.log("  png       " + target);
    return;
  }
  if (rest.length === 0) {
    console.error("usage: bun scripts/cad-eval.mjs <prompt...> | --file <scenarios.json> [--out DIR]");
    process.exit(2);
  }
  const env = loadEnv(path.join(PROJECT_ROOT, ".env"));
  if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing from .env");
  const runDir = nextAttemptDir(outDir);
  console.log("run directory: " + runDir);

  // Kernel options, the locateFile workaround and the delivery-fidelity segment
  // count live in the shared harness module - see scripts/lib/cad-harness.mjs.
  const { module, kernel } = await loadCadKernel();
  const generator = cadGeneratorFrom(env);

  for (const scenario of scenariosFrom(rest)) {
    await runScenario({ generator, kernel, module, outDir: runDir, scenario });
  }
  console.log("\nrenders written to " + runDir);
}

/**
 * Generates, builds, renders and reports one scenario.
 * @param {{ generator: any, kernel: any, module: any, outDir: string,
 *   scenario: { name: string, prompt: string } }} ctx Run context.
 * @returns {Promise<void>} Resolves once the scenario has been reported.
 */
async function runScenario(ctx) {
  const { generator, outDir, scenario } = ctx;
  const stem = slug(scenario.name);
  console.log("\n=== " + scenario.name + " ===");
  console.log("PROMPT: " + scenario.prompt);
  const started = Date.now();
  try {
    const result = await generator.generate({ prompt: scenario.prompt });
    console.log("generate " + (Date.now() - started) + "ms  attempts=" +
      result.diagnostics.attempts.length + "  tokens=" + JSON.stringify(result.diagnostics.tokens));
    console.log("summary: " + result.design.summary);
    const sel = result.diagnostics.selection;
    console.log("selection " + sel.source + ": " + (sel.libraries.map((/** @type {string} */ id) =>
      id + (sel.fit[id] ? "=" + sel.fit[id].score.toFixed(2) : "")).join(", ") || "(none)") +
      (sel.error ? "  [" + sel.error + "]" : ""));
    // Written BEFORE the build, so a design whose kernel run throws is still on
    // disk to read: that is exactly when its code is most wanted.
    fs.writeFileSync(path.join(outDir, stem + ".json"), JSON.stringify(result.design, null, 2));
    const buildStart = Date.now();
    const { expectedPieces: pieces, piecesSeparate } = result.diagnostics.selection;
    if (pieces !== undefined) {
      console.log("expected pieces " + (pieces >= 5 ? "5+" : pieces) +
        (piecesSeparate === undefined ? "" : "  separate " + piecesSeparate.toFixed(2)) +
        "  min bodies " + bodyFloor(pieces, piecesSeparate));
    }
    const built = await buildWithClientRepair({
      generator, kernel: ctx.kernel, prompt: scenario.prompt,
      onRepair: (round, failure) => console.log("client repair " + round + ": " + failure.error.slice(0, 160)),
      onDesign: (design) => fs.writeFileSync(path.join(outDir, stem + ".json"), JSON.stringify(design, null, 2)),
    }, result);
    if (!built.run) {
      const last = built.failures[built.failures.length - 1];
      console.log("FAILED after " + (built.failures.length - 1) + " client repair(s): " + last.error);
      return;
    }
    const { mesh, stats } = built.run;
    result.design = built.design;
    console.log("kernel   " + (Date.now() - buildStart) + "ms  " + JSON.stringify(stats));
    const { solids, meshes, tints } = componentsOf(ctx.module, result.design);
    console.log("solids   " + solids + (solids > 1 ? "   <-- NOT ONE BODY, pieces are not joined" : ""));
    const png = path.join(outDir, stem + ".png");
    console.log("png " + png + " (" + renderComponents(png, meshes, tints, {}) + " B)");
    const written = writeExports(path.join(outDir, stem), mesh, result.design);
    console.log("glb " + written.glb + " B  3mf " + written.threeMf + " B");
  } catch (e) {
    console.log("FAILED after " + (Date.now() - started) + "ms: " + (e instanceof Error ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error("HARNESS_FATAL", e);
  process.exit(1);
});
