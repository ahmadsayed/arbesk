/**
 * Licence gate and ranking for OpenSCAD sources we might port into the library.
 *
 * NOT part of the server. Run before ANY port: a source is portable only when
 * GitHub's SPDX detection AND Jev's reading of the licence text both say it is
 * permissive or attribution-only - and a human (or the porting agent) has read
 * the text too. Any disagreement rejects the candidate. Copyleft is never
 * ported: translating code is creating a derivative work.
 *
 * Usage:
 *   bun scripts/cad-candidates.mjs <owner/repo>[:<path/to/file.scad>] ...
 *
 * Results are merged into test-results/reference/candidates.json (gitignored),
 * keyed by repo, so the ranking accumulates across runs.
 *
 * Jev is TypeSafe AI's decision model (docs.typesafe.ai): one call per
 * candidate asks a `choice` (licence class), a `noul` (does the file header
 * carry its own, different licence?) and a `score` (usefulness).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { askJev } from "../packages/cad-gen/src/backend/jev.ts";
import { PROJECT_ROOT, loadEnv } from "./lib/cad-harness.mjs";

const OUT = path.join(PROJECT_ROOT, "test-results", "reference", "candidates.json");

/** Licence classes, as Jev chooses among them. Only the first two are portable. */
const LICENCE_CLASSES = {
  permissive: "MIT, BSD, Apache-2.0, ISC, zlib, CC0 or Unlicense: use and modify freely, at most keep a notice",
  attribution: "CC-BY (any version, WITHOUT ShareAlike or NonCommercial): free use, credit required",
  share_alike: "CC-BY-SA: derivatives must carry the same licence",
  copyleft: "GPL, LGPL, AGPL, MPL, EUPL or any licence that makes derivatives open under it",
  noncommercial: "CC-BY-NC or any terms restricting commercial use",
  proprietary: "All rights reserved, or no permission to copy or modify",
  none: "No licence text at all",
};
const PORTABLE = new Set(["permissive", "attribution"]);
const PORTABLE_SPDX = /^(MIT|BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|Unlicense|CC-BY-[0-9.]+)$/;

const USEFULNESS = [
  "Not reusable - a one-off model for a specific machine",
  "Narrow - useful for one specific product",
  "Useful - a parametric part many people print",
  "Very useful - a parametric generator for a common class of parts",
];

/**
 * @param {string} repo owner/name.
 * @param {string} p Path in the repo.
 * @returns {string} The file's text, or "" when it does not exist.
 */
function ghFile(repo, p) {
  try {
    return execFileSync("gh", ["api", "repos/" + repo + "/contents/" + p, "-H",
      "Accept: application/vnd.github.raw"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** @param {string} repo owner/name. @returns {string} GitHub's detected SPDX id, or "none". */
function ghSpdx(repo) {
  try {
    return execFileSync("gh", ["api", "repos/" + repo, "--jq", ".license.spdx_id // \"none\""],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "none";
  }
}

/**
 * Judges one candidate.
 * @param {{ apiKey: string }} jev Jev config.
 * @param {string} spec owner/repo or owner/repo:path/to/file.scad.
 */
async function judge(jev, spec) {
  const [repo, file] = spec.split(":");
  const licence = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].map((p) => ghFile(repo, p))
    .find((t) => t.length > 0) ?? "";
  const header = file ? ghFile(repo, file).split("\n").slice(0, 40).join("\n") : "";
  const readme = ghFile(repo, "README.md").slice(0, 3000);
  const spdx = ghSpdx(repo);

  const body = await askJev(jev, {
    repository: repo,
    licence_file: licence.slice(0, 6000) || "(no licence file)",
    source_file_path: file ?? "(none)",
    source_file_header: header || "(no file given)",
    readme,
  }, {
    licence_class: {
      type: "choice",
      instructions: "Which class does the licence governing this repository's code belong to? " +
        "Judge from the licence file text itself.",
      criteria: LICENCE_CLASSES,
    },
    header_overrides: {
      type: "noul",
      // Not the header alone: rcarmo/openscad-kp3spro-filler is MIT, but its
      // README says filler-profile-brace.scad was copied from a Thingiverse
      // project - the header says nothing, and the first version of this
      // question passed it.
      instructions: "Consider the SOURCE FILE named in source_file_path. Does its header, or the " +
        "README, say that this file (or code in it) was copied from ANOTHER project or author, " +
        "or is under different licence terms from the licence file?",
      criteria: {
        true: "This file came from elsewhere or has other terms",
        false: "This file is the repository's own work under its licence file",
      },
    },
    usefulness: {
      type: "score",
      instructions: "How useful is this design as a reusable generator for parts people ask a " +
        "3D-printing CAD assistant to make?",
      criteria: USEFULNESS,
    },
  });
  const a = body.answers;
  const jevClass = a.licence_class.choice;
  const portable = PORTABLE.has(jevClass) && PORTABLE_SPDX.test(spdx) && a.header_overrides.noul < 0.5;
  return {
    repo, file: file ?? null, spdx,
    jev: {
      licenceClass: jevClass,
      licenceConfidence: a.licence_class.confidence,
      headerOverrides: a.header_overrides.noul,
      usefulness: a.usefulness.score,
    },
    copyright: (licence.match(/Copyright[^\n]*/) ?? [""])[0].trim(),
    portable,
    reason: portable ? "GitHub and Jev agree: " + spdx + " / " + jevClass
      : "REJECTED: GitHub " + spdx + ", Jev " + jevClass +
        (a.header_overrides.noul >= 0.5 ? ", the file came from elsewhere or has other terms" : ""),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * judge(), retried with backoff; a candidate that still fails is recorded as an
 * error rather than ending the batch.
 * @param {{ apiKey: string, timeoutMs: number }} jev Jev config.
 * @param {string} spec The candidate.
 */
async function judgeWithRetry(jev, spec) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await judge(jev, spec);
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { repo: spec.split(":")[0], file: spec.split(":")[1] ?? null, error: last, portable: false,
    checkedAt: new Date().toISOString() };
}

async function main() {
  const specs = process.argv.slice(2);
  if (specs.length === 0) {
    console.error("usage: bun scripts/cad-candidates.mjs <owner/repo>[:<file.scad>] ...");
    process.exit(2);
  }
  const env = loadEnv(path.join(PROJECT_ROOT, ".env"));
  if (!env.JEV_API_KEY) throw new Error("JEV_API_KEY missing from .env");
  // Offline: a slow answer is fine, a lost batch is not.
  const jev = { apiKey: env.JEV_API_KEY, timeoutMs: 30000 };
  const force = specs[0] === "--force";
  if (force) specs.shift();
  /** @type {Record<string, any>} */
  const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const spec of specs) {
    if (!force && all[spec] && !all[spec].error) continue;
    const r = /** @type {any} */ (await judgeWithRetry(jev, spec));
    all[spec] = r;
    // Saved per candidate: a batch of a hundred is ten minutes of calls.
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
    console.log(r.error ? "ERR " + spec.padEnd(60) + " " + r.error
      : (r.portable ? "OK  " : "NO  ") + spec.padEnd(60) + " usefulness " +
        r.jev.usefulness.toFixed(2) + "  " + r.reason);
  }
  console.log("\nranked (portable only):");
  for (const r of Object.values(all).filter((x) => x.portable && !x.error).sort((x, y) => y.jev.usefulness - x.jev.usefulness)) {
    console.log("  " + r.jev.usefulness.toFixed(2) + "  " + r.repo + (r.file ? ":" + r.file : ""));
  }
}

main().catch((e) => {
  console.error("CANDIDATES_FATAL", e);
  process.exit(1);
});
