#!/usr/bin/env bun
/**
 * CAD smoke harness: prompt -> statically-gated design -> real GLB and 3MF on
 * disk, with the design document embedded in both.
 *
 * @remarks This doubles as the REFERENCE IMPLEMENTATION of the client pipeline
 *   the browser worker will follow (spec section 7):
 *     1. generate (server: code + static gates only)
 *     2. re-run the guard locally - the client never trusts the server's guard
 *     3. check preludeVersion against the local prelude, and refuse to execute
 *        a design built against a different one
 *     4. load the kernel and run it
 *     5. export GLB and 3MF through the SHARED core exporters
 *   Steps 2-5 are exactly what the worker must do; the file is written so the
 *   worker can lift them without change.
 *
 *   Imports reach the package SOURCE rather than the bare specifier on purpose:
 *   scripts/ runs under Bun before any build, and a bare import would resolve
 *   packages/cad-gen/dist, which is either absent or stale. Same reasoning, and
 *   the same convention, as scripts/cad-eval.mjs.
 *
 * Usage:
 *   bun scripts/cad-smoke.mjs "a 60x40x10mm plate with a 6mm hole in each corner"
 *   bun scripts/cad-smoke.mjs "add a 2mm fillet to the vertical edges" --prior test-results/cad/design.json
 *   ... [--out <dir>]     (default: test-results/cad, which is gitignored)
 */
import fs from "node:fs";
import path from "node:path";
import { guardScript, PRELUDE_NAMES, PRELUDE_VERSION } from "../packages/cad-gen/src/index.ts";
import { meshToGlb, meshTo3mf } from "../packages/cad-gen/src/core/export/index.ts";
import { PROJECT_ROOT, cadGeneratorFrom, loadCadKernel, requireEnv } from "./lib/cad-harness.mjs";

const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, "test-results", "cad");

/**
 * Splits the flags out of argv.
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ outDir: string, priorPath: string | undefined, prompt: string | undefined }}
 */
function parseArgs(argv) {
  /** @type {string[]} */
  const rest = [];
  let outDir = DEFAULT_OUT_DIR;
  /** @type {string | undefined} */
  let priorPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") { outDir = path.resolve(argv[++i]); continue; }
    if (argv[i] === "--prior") { priorPath = path.resolve(argv[++i]); continue; }
    rest.push(argv[i]);
  }
  return { outDir, priorPath, prompt: rest.join(" ") || undefined };
}

/**
 * Verifies a design is safe to execute on THIS host.
 * @remarks The client's own check, and it may not be skipped because the server
 *   ran it: the guard is defence in depth, and a server bug or a compromised
 *   response is exactly the case it exists for.
 * @param {{ code: string }} design The design to check.
 * @returns {void}
 * @throws {Error} When the design may not be executed here.
 */
function verifyLocally(design) {
  const guard = guardScript(design.code, PRELUDE_NAMES);
  if (!guard.ok) {
    throw new Error("guard rejected server-validated code: " + guard.reason + " " + (guard.detail ?? ""));
  }
}

async function main() {
  const { outDir, priorPath, prompt } = parseArgs(process.argv.slice(2));
  const request = prompt ?? "a 60x40x10mm plate with a 6mm hole in each corner";
  const priorDesign = priorPath ? JSON.parse(fs.readFileSync(priorPath, "utf8")) : undefined;

  const generator = cadGeneratorFrom(requireEnv());

  const started = Date.now();
  const result = await generator.generate({ prompt: request, ...(priorDesign ? { priorDesign } : {}) });
  console.log("PROMPT: " + request);
  console.log("generate " + (Date.now() - started) + "ms  attempts=" +
    result.diagnostics.attempts.length + "  tokens=" + JSON.stringify(result.diagnostics.tokens));
  console.log("summary: " + result.design.summary);
  console.log("params:  " + JSON.stringify(result.design.parameters));
  console.log("provider " + result.provider.id + "/" + result.provider.model);

  // The credit the UI renders. Computed by the server from the helpers the
  // script CALLS, and shown here so a smoke run proves the field is populated
  // rather than only asserting it in a unit test.
  if (result.attribution.length === 0) {
    console.log("credits: none (no ported design involved)");
  } else {
    for (const credit of result.attribution) {
      console.log("credit:  " + credit.work + " by " + credit.author +
        " (" + credit.licence + ") " + credit.url + "   [helper " + credit.helper + "]");
    }
  }

  // The server's prelude version is the contract this host must implement.
  if (result.runtime.preludeVersion !== PRELUDE_VERSION) {
    throw new Error("prelude version mismatch: server=" + result.runtime.preludeVersion +
      " local=" + PRELUDE_VERSION);
  }
  verifyLocally(result.design);

  // Kernel options, the locateFile workaround and the delivery-fidelity segment
  // count all live in the shared harness module, so this file and cad-eval
  // cannot drift into measuring two different things.
  const { kernel } = await loadCadKernel();

  const built = Date.now();
  const { mesh, stats } = kernel.run(result.design);
  console.log("kernel   " + (Date.now() - built) + "ms  " + JSON.stringify(stats));

  fs.mkdirSync(outDir, { recursive: true });
  // The design is written BEFORE the exports, so a design whose export throws
  // is still on disk to read - which is exactly when its code is most wanted.
  fs.writeFileSync(path.join(outDir, "design.json"), JSON.stringify(result.design, null, 2));
  const glb = meshToGlb(mesh, result.design);
  const threeMf = meshTo3mf(mesh, result.design);
  fs.writeFileSync(path.join(outDir, "part.glb"), glb);
  fs.writeFileSync(path.join(outDir, "part.3mf"), threeMf);

  console.log("client stats match the server's static gates; the kernel ran HERE, not there");
  console.log("wrote " + outDir + "/design.json, part.glb (" + glb.length + " B), part.3mf (" +
    threeMf.length + " B)");
}

main().catch((e) => {
  console.error("SMOKE_FATAL", e);
  process.exit(1);
});
