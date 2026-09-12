/**
 * Shared plumbing for the CAD harnesses (scripts/cad-eval.mjs and
 * scripts/cad-smoke.mjs).
 *
 * @remarks Extracted because the two harnesses had drifted into three
 *   near-identical blocks: the .env reader, the kernel loader and the generator
 *   construction. The kernel loader is the one that matters - it encodes the
 *   locateFile workaround AND the delivery-fidelity segment count, and two
 *   copies of that is two places for a harness to quietly stop measuring what
 *   the user would actually get.
 *
 *   These import the package SOURCE, not the bare specifier: harnesses run
 *   under Bun before any build, where packages/cad-gen/dist is absent or stale.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "manifold-3d";
import { createCadGenerator } from "../../packages/cad-gen/src/backend/index.ts";
import { createCadKernel } from "../../packages/cad-gen/src/core/kernel.ts";

/** Repository root, resolved from this file rather than from the caller's cwd. */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Directory holding manifold.wasm and its Emscripten glue. */
export const WASM_DIR = path.join(PROJECT_ROOT, "node_modules", "manifold-3d");

/** Segment count at DELIVERY fidelity, not the old coarse validation proxy. */
const DELIVERY_SEGMENTS = 64;

/**
 * Minimal .env reader.
 * @remarks The repo's env files are KEY=value with no interpolation, so this
 *   stays deliberately smaller than a dotenv dependency.
 * @param {string} file Path to the env file.
 * @returns {Record<string, string>} Parsed key/value pairs; empty when absent.
 */
export function loadEnv(file) {
  /** @type {Record<string, string>} */
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/**
 * Reads the project .env and insists on a provider key.
 * @param {string} [file] Env file path; defaults to the project root .env.
 * @returns {Record<string, string>} The parsed environment.
 * @throws {Error} When DEEPSEEK_API_KEY is absent.
 */
export function requireEnv(file = path.join(PROJECT_ROOT, ".env")) {
  const env = loadEnv(file);
  if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing from " + file);
  return env;
}

/**
 * Loads the Manifold kernel module and builds a delivery-fidelity kernel.
 *
 * @remarks The locateFile cast is not cosmetic. manifold.d.ts declares
 *   locateFile as zero-arity while Emscripten calls it WITH the filename, so a
 *   correct callback fails the typed config (TS2322). Type the options bag as
 *   any rather than casting the callback; do NOT "fix" the upstream .d.ts, an
 *   upgrade would silently drop the patch.
 * @param {string} [wasmDir] Directory holding manifold.wasm; defaults to WASM_DIR.
 * @returns {Promise<{ module: any, kernel: any }>} The module and the kernel.
 */
export async function loadCadKernel(wasmDir = WASM_DIR) {
  /** @type {any} */
  const moduleOptions = { locateFile: (/** @type {string} */ f) => path.join(wasmDir, f) };
  const module = await Module(moduleOptions);
  // manifold-3d registers its JS API lazily; without setup() Manifold.cube is
  // undefined and every script dies with "Manifold.cube is not a function".
  module.setup();
  return { module, kernel: createCadKernel(module, { segments: DELIVERY_SEGMENTS }) };
}

/**
 * Builds the generator the harnesses share.
 * @param {Record<string, string>} env Parsed environment.
 * @returns {any} A configured CadGenerator.
 */
export function cadGeneratorFrom(env) {
  return createCadGenerator({
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.CAD_MODEL || "deepseek-flash",
    ...(env.DEEPSEEK_BASE_URL ? { baseUrl: env.DEEPSEEK_BASE_URL } : {}),
    ...(env.CAD_THINKING ? { thinking: true } : {}),
  });
}
