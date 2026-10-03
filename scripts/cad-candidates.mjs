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
 *   bun scripts/cad-candidates.mjs [--force] <owner/repo>[:<path/to/file.scad>] ...
 *   bun scripts/cad-candidates.mjs [--force] --all    re-judge every saved candidate
 *
 * Results are merged into test-results/reference/candidates.json (gitignored),
 * keyed by repo, so the ranking accumulates across runs. A saved record is
 * skipped unless it errored or was judged under an older RUBRIC, so an
 * interrupted `--all` resumes where it stopped; `--force` re-asks regardless.
 *
 * Jev is TypeSafe AI's decision model (docs.typesafe.ai): one call per
 * candidate asks a `choice` (licence class), a `noul` (did this file come from
 * elsewhere?) and the ranking questions in RANKING (see rankOf()).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { askJev } from "../packages/cad-gen/src/backend/jev.ts";
import { PROJECT_ROOT, loadEnv } from "./lib/cad-harness.mjs";

const OUT = path.join(PROJECT_ROOT, "test-results", "reference", "candidates.json");

/** Licence classes, as Jev chooses among them. Only the first two are portable. */
const LICENCE_CLASSES = {
  permissive: "MIT, BSD, Apache-2.0, ISC, zlib, CC0, Unlicense or CERN-OHL-P (the Permissive variant " +
    "of the CERN Open Hardware Licence): use and modify freely, at most keep notices",
  attribution: "CC-BY (any version, WITHOUT ShareAlike or NonCommercial): free use, credit required",
  share_alike: "CC-BY-SA: derivatives must carry the same licence",
  copyleft: "GPL, LGPL, AGPL, MPL, EUPL, CERN-OHL-S or CERN-OHL-W (the reciprocal CERN variants), or " +
    "any licence that makes derivatives open under it",
  noncommercial: "CC-BY-NC or any terms restricting commercial use",
  proprietary: "All rights reserved, or no permission to copy or modify",
  none: "No licence text at all",
};
const PORTABLE = new Set(["permissive", "attribution"]);
/**
 * GitHub SPDX ids we accept. CERN-OHL-P-2.0 was added after reading the
 * licence text (ohwr.org/cern_ohl_p_v2.txt): s3.4 lets you "Convey Covered
 * Source or modified Covered Source under licence terms which differ from the
 * terms of this Licence", so there is no share-alike. Its obligations are
 * notices only - s3.1/3.2 retain Notices, s3.3(b) add a dated modification
 * notice, s3.4(b) pass on a copy of the licence. Its siblings CERN-OHL-S
 * (strongly) and CERN-OHL-W (weakly reciprocal) are copyleft and stay out.
 */
const PORTABLE_SPDX = /^(MIT|BSD-[23]-Clause|Apache-2\.0|ISC|Zlib|CC0-1\.0|Unlicense|CC-BY-[0-9.]+|CERN-OHL-P-2\.0)$/;

/** Bumped whenever RANKING changes; records judged under another rubric are re-asked. */
const RUBRIC = 2;

/**
 * The ranking questions, asked in the same call as the licence. They replaced
 * one 0-3 `usefulness` score that saturated (45 of ~125 repos at >= 2.8, AI
 * "skill" bundles among the top). Each score has four levels, 0-3.
 */
const RANKING = {
  is_scad_design: {
    type: "noul",
    // The SKILL.md clause is explicit because huseyintamer/boxgen-skills ships
    // one enclosure.scad template inside an agent-skill bundle and scored 0.95
    // without it.
    instructions: "Is this repository an OpenSCAD design project or library - its main content " +
      "OpenSCAD source that models printable parts or shapes? Judge from file_tree and " +
      "scad_sample. Answer false for an AI agent skill or plugin bundle (SKILL.md files, " +
      ".claude-plugin, prompts) even when it ships a .scad template, and for web apps, " +
      "converters, Python/JS generators or STL-only repositories that merely use or emit OpenSCAD.",
    criteria: {
      true: "Real OpenSCAD modelling source, the repository's main content",
      false: "Tooling, prompts, skills, an app, or no OpenSCAD modelling source",
    },
  },
  general_purpose: {
    type: "score",
    instructions: "How general is what this design makes? A generator for a whole class of parts " +
      "that many different users need (gears, threads, boxes, bins, hinges, enclosures, " +
      "knobs) ranks high; a filler, mount or spare part for ONE specific printer, device or " +
      "product ranks low.",
    criteria: [
      "One-off - fits one specific machine, device or product",
      "Narrow - one kind of part for a small audience",
      "Broad - a common part many people print, in a few variants",
      "General - a generator or library for a whole class of parts",
    ],
  },
  parametric: {
    type: "score",
    instructions: "How parametric is the OpenSCAD source in scad_sample: are the dimensions " +
      "named variables or module arguments that change the part coherently?",
    criteria: [
      "Not parametric - hard-coded numbers, or no OpenSCAD source",
      "A few top-level variables",
      "Customizer-style parameters driving most dimensions",
      "Reusable modules with documented arguments",
    ],
  },
  printability: {
    type: "score",
    // "For a library" because BOSL2 scored 0.4 of 3 when judged as one output.
    instructions: "How well are the parts this design makes suited to FDM 3D printing: flat " +
      "bases, no unsupported overhangs, print tolerances or clearances considered? For a " +
      "library, judge the parts it is meant to build and any print-specific helpers it offers.",
    criteria: [
      "Not for printing, or no printable output",
      "Printable with effort - supports or unclear tolerances",
      "Printable - designed for FDM",
      "Print-tuned - tolerances, clearances and orientation considered",
    ],
  },
  maturity: {
    type: "score",
    instructions: "How mature and trustworthy is the project: documentation, examples, stars, " +
      "recent activity and code quality as seen in readme, repo_meta and scad_sample?",
    criteria: [
      "Abandoned stub or experiment",
      "Personal project, little documentation",
      "Documented and used",
      "Established library or project with examples and users",
    ],
  },
};

/**
 * Combined rank, 0-1:
 *
 *   rank = isScadDesign * (0.25 + 0.75 * generalPurpose / 3)
 *                       * (parametric + printability + maturity) / 9
 *
 * Both gates multiply. isScadDesign (a probability) sinks skill bundles and
 * tooling; generalPurpose sinks one-offs to a quarter, because a port pays
 * only when many requests can call it - a weighted SUM let a well-made
 * printer-specific filler (rcarmo/openscad-kp3spro-filler) sit at 0.46,
 * next to the general spool holder at 0.60. The quality mean ranks the rest.
 * @param {Record<string, number>} j A record's jev block.
 * @returns {number} The rank.
 */
function rankOf(j) {
  const gate = j.isScadDesign * (0.25 + 0.75 * j.generalPurpose / 3);
  return gate * (j.parametric + j.printability + j.maturity) / 9;
}

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

/** @param {string[]} args gh api arguments. @returns {any} Parsed JSON, or null on failure. */
function ghJson(args) {
  try {
    return JSON.parse(execFileSync("gh", ["api", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }));
  } catch {
    return null;
  }
}

/**
 * @param {string} repo owner/name.
 * @returns {{ spdx: string, meta: object, blobs: { path: string, size: number }[] }}
 *   GitHub's detected SPDX id ("none" when absent), a little metadata for the
 *   maturity question, and every file in the default branch.
 */
function ghRepo(repo) {
  const r = ghJson(["repos/" + repo]) ?? {};
  const tree = ghJson(["repos/" + repo + "/git/trees/HEAD?recursive=1"]);
  return {
    spdx: r.license?.spdx_id ?? "none",
    meta: { description: r.description, stars: r.stargazers_count, pushed_at: r.pushed_at,
      archived: r.archived, topics: r.topics },
    blobs: (tree?.tree ?? []).filter((/** @type {any} */ t) => t.type === "blob")
      .map((/** @type {any} */ t) => ({ path: t.path, size: t.size ?? 0 })),
  };
}

/**
 * A compact view of the tree for the is_scad_design question: counts per
 * extension, top-level entries, and some .scad paths.
 * @param {string[]} files Every file path.
 */
function treeSummary(files) {
  /** @type {Record<string, number>} */
  const byExt = {};
  for (const f of files) {
    const ext = path.extname(f).toLowerCase() || "(none)";
    byExt[ext] = (byExt[ext] ?? 0) + 1;
  }
  const scad = files.filter((f) => f.endsWith(".scad"));
  return {
    files: files.length,
    by_extension: Object.fromEntries(Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    top_level: [...new Set(files.map((f) => f.split("/")[0]))].slice(0, 40),
    scad_files: scad.slice(0, 30),
    skill_files: files.filter((f) => /(^|\/)SKILL\.md$/i.test(f)).slice(0, 5),
  };
}

/**
 * What the parametric question reads: the named file, else the LARGEST .scad
 * at the shallowest depth (the shallowest alone picked BOSL2's std.scad, a list
 * of includes, and Jev scored the library 0.2 of 3). Its first lines, then
 * every module/function signature and top-level assignment - the parameters.
 * @param {string} repo owner/name.
 * @param {string | undefined} file The named file.
 * @param {{ path: string, size: number }[]} blobs Every file.
 */
function scadSample(repo, file, blobs) {
  const scad = blobs.filter((b) => b.path.endsWith(".scad"));
  const depth = (/** @type {string} */ p) => p.split("/").length;
  const shallowest = Math.min(...scad.map((b) => depth(b.path)));
  const pick = file ?? scad.filter((b) => depth(b.path) === shallowest)
    .sort((a, b) => b.size - a.size)[0]?.path;
  if (!pick) return "(no .scad file)";
  const lines = ghFile(repo, pick).split("\n");
  const signatures = lines.filter((l) => /^\s*(module|function)\s+\w+\s*\(|^[A-Za-z_]\w*\s*=/.test(l));
  return ("// " + pick + "\n" + lines.slice(0, 30).join("\n") +
    "\n// ... signatures and top-level parameters:\n" + signatures.join("\n")).slice(0, 5000);
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
  const { spdx, meta, blobs } = ghRepo(repo);

  const body = await askJev(jev, {
    repository: repo,
    licence_file: licence.slice(0, 6000) || "(no licence file)",
    source_file_path: file ?? "(none)",
    source_file_header: header || "(no file given)",
    readme,
    repo_meta: meta,
    file_tree: treeSummary(blobs.map((b) => b.path)),
    scad_sample: scadSample(repo, file, blobs),
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
    ...RANKING,
  });
  const a = body.answers;
  const scores = {
    isScadDesign: a.is_scad_design.noul,
    generalPurpose: a.general_purpose.score,
    parametric: a.parametric.score,
    printability: a.printability.score,
    maturity: a.maturity.score,
  };
  const jevClass = a.licence_class.choice;
  const portable = PORTABLE.has(jevClass) && PORTABLE_SPDX.test(spdx) && a.header_overrides.noul < 0.5;
  return {
    repo, file: file ?? null, spdx,
    jev: {
      licenceClass: jevClass,
      licenceConfidence: a.licence_class.confidence,
      headerOverrides: a.header_overrides.noul,
      ...scores,
      rank: rankOf(scores),
    },
    rubric: RUBRIC,
    copyright: (licence.match(/Copyright[^\n]*/) ?? [""])[0].trim(),
    portable,
    reason: portable ? "GitHub and Jev agree: " + spdx + " / " + jevClass
      : "REJECTED: GitHub " + spdx + ", Jev " + jevClass +
        (a.header_overrides.noul >= 0.5 ? ", the file came from elsewhere or has other terms" : ""),
    checkedAt: new Date().toISOString(),
  };
}

/** @param {any} r A record. @returns {string} Its component scores and rank, for the log. */
function scoreLine(r) {
  const j = r.jev;
  return "rank " + j.rank.toFixed(3) + "  scad " + j.isScadDesign.toFixed(2) + " gen " +
    j.generalPurpose.toFixed(2) + " par " + j.parametric.toFixed(2) + " print " +
    j.printability.toFixed(2) + " mat " + j.maturity.toFixed(2);
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
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const everything = args.includes("--all");
  /** @type {Record<string, any>} */
  const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const specs = everything ? Object.keys(all) : args.filter((a) => !a.startsWith("--"));
  if (specs.length === 0) {
    console.error("usage: bun scripts/cad-candidates.mjs [--force] (--all | <owner/repo>[:<file.scad>] ...)");
    process.exit(2);
  }
  const env = loadEnv(path.join(PROJECT_ROOT, ".env"));
  if (!env.JEV_API_KEY) throw new Error("JEV_API_KEY missing from .env");
  // Offline: a slow answer is fine, a lost batch is not.
  const jev = { apiKey: env.JEV_API_KEY, timeoutMs: 30000 };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const spec of specs) {
    if (!force && all[spec] && !all[spec].error && all[spec].rubric === RUBRIC) continue;
    const r = /** @type {any} */ (await judgeWithRetry(jev, spec));
    all[spec] = r;
    // Saved per candidate: a batch of a hundred is ten minutes of calls.
    fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
    console.log(r.error ? "ERR " + spec.padEnd(60) + " " + r.error
      : (r.portable ? "OK  " : "NO  ") + spec.padEnd(60) + " " + scoreLine(r) + "  " + r.reason);
  }
  console.log("\nranked (portable, current rubric):");
  const ranked = Object.values(all).filter((x) => x.portable && !x.error && x.rubric === RUBRIC);
  for (const r of ranked.sort((x, y) => y.jev.rank - x.jev.rank)) {
    console.log("  " + scoreLine(r) + "  " + r.repo + (r.file ? ":" + r.file : ""));
  }
}

main().catch((e) => {
  console.error("CANDIDATES_FATAL", e);
  process.exit(1);
});
