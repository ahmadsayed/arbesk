/**
 * The CADPrompt benchmark dataset: fetch, load, stratify, rewrite.
 * @remarks CADPrompt (Alrashedy et al., ICLR 2025) is 200 text prompts with
 *   ground-truth meshes. The repository has NO licence, so it is fetched at run
 *   time into gitignored test-results/ for local evaluation only and is never
 *   committed or redistributed. Pinned to one commit so scores stay comparable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CADPROMPT_REPO = "https://github.com/Kamel773/CAD_Code_Generation";
export const CADPROMPT_PIN = "33dcecd6087ff7b8a4454b1ba4d56504a6364399";
export const CADPROMPT_DIR = path.resolve(import.meta.dirname, "..", "..", "test-results", "cadprompt");

const MEASURED_FILE = "Natural_Language_Descriptions_Prompt_with_specific_measurements.txt";
const ABSTRACT_FILE = "Natural_Language_Descriptions_Prompt.txt";

/** Paper section 4: Easy when at least 4 of its 6 attempts compiled. */
const EASY_FROM = 4;

/** A number as CADPrompt writes one: optional sign, decimals, exponent. */
const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE]-?\d+)?`;

/** "0.5 units", "0.5 by 0.3 units", "1 x 2 x 3 unit" - a length list in benchmark units. */
const UNIT_LIST = new RegExp(String.raw`(${NUM}(?:\s*(?:by|x|×)\s*${NUM})*)\s*units?\b`, "gi");

/** The CadQuery instruction every CADPrompt prompt opens with, in its observed spellings. */
const PREFIX = /^\s*write (?:a )?python (?:code|script) (?:using|in|with) cad ?query\s*(?:to|for|that)?\s*/i;

/**
 * A decimal the rewrite left alone that is still a length: not followed by a
 * unit the model can act on, by "times" (a ratio), or by "by <n>" (a list
 * whose last member was scaled).
 */
const UNSCALED = /\d+\.\d+(?!\d)(?!\s*(?:mm|degrees?|°|meters?|metres?|inch(?:es)?|times)\b)(?!\s*(?:by|x|×)\s*-?\d)/i;

/** An arithmetic operator just before a number: "0.6 + 0.1*2 units" must not become "...*200 mm". */
const OPERATOR_BEFORE = /[*+/-]\s*$/;

/** Verbs a stripped prompt may already start with. */
const VERB = /^(?:create|make|build|design|generate|model|draw|construct)\b/i;

const MM_NOTE = " Dimensions are in millimetres.";
const FALLBACK_NOTE = " Lengths are given in units where 1 unit = 100 mm; build the part at that scale, in millimetres.";

/**
 * Multiplies a benchmark length by 100 and prints it without float noise.
 * @param {string} n
 * @returns {string}
 */
const scaled = (n) => String(Number((Number(n) * 100).toPrecision(6)));

/**
 * Drops the CadQuery instruction and leaves an imperative request.
 * @param {string} text
 * @returns {string}
 */
function stripPrefix(text) {
  const body = text.trim().replace(PREFIX, "");
  return VERB.test(body) ? body[0].toUpperCase() + body.slice(1) : "Create " + body;
}

/**
 * Turns a CADPrompt prompt into a request cad-gen can take.
 * @remarks Measured prompts state lengths in tiny unitless "units"; cad-gen's
 *   system prompt and helpers are written for millimetre parts, so lengths are
 *   scaled x100. Where scaling cannot be done safely - coordinate tuples,
 *   arithmetic on lengths - the prompt keeps its numbers and states the
 *   conversion instead ("fallback"), rather than mixing scaled and unscaled
 *   lengths in one request.
 * @param {string} text Raw prompt file contents.
 * @param {"measured" | "abstract"} variant
 * @returns {{ prompt: string, rewrite: "scaled" | "fallback" | "none", suspect: boolean }}
 *   suspect: a human may want to read this one.
 */
export function rewritePrompt(text, variant) {
  const body = stripPrefix(text);
  const leftover = /cad ?query|python/i.test(body);
  if (variant === "abstract") return { prompt: body + MM_NOTE, rewrite: "none", suspect: leftover };
  let expression = false;
  const scaledBody = body.replace(UNIT_LIST, (match, list, offset, whole) => {
    if (OPERATOR_BEFORE.test(whole.slice(0, offset))) {
      expression = true;
      return match;
    }
    return list.replace(new RegExp(NUM, "g"), scaled) + " mm";
  });
  if (expression || UNSCALED.test(scaledBody)) {
    return { prompt: body + FALLBACK_NOTE, rewrite: "fallback", suspect: true };
  }
  return { prompt: scaledBody + MM_NOTE, rewrite: "scaled", suspect: leftover };
}

/** @typedef {{ geometric: string, mesh: string, compiled: number, difficulty: "Easy" | "Hard" }} Strata */

/**
 * Reads Data_Stratification.xlsx's one sheet from its raw XML parts.
 * @remarks Columns: A id (numeric: 7 for directory 00000007), B semantic /
 *   geometric complexity, C mesh complexity, D how many of the paper's 6
 *   attempts compiled. String cells index the shared-strings table and carry
 *   stray leading spaces.
 * @param {string} sharedXml xl/sharedStrings.xml
 * @param {string} sheetXml xl/worksheets/sheet1.xml
 * @returns {Map<string, Strata>} Keyed by 8-digit sample id.
 */
export function parseStrata(sharedXml, sheetXml) {
  const strings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("").trim());
  /** @type {Map<string, Strata>} */
  const strata = new Map();
  for (const row of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    /** @type {Record<string, string | number>} */
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/g)) {
      const [, col, attrs, v] = c;
      if (v === undefined) continue;
      cells[col] = /t="s"/.test(attrs) ? strings[Number(v)] : Number(v);
    }
    if (typeof cells.A !== "number") continue; // the header row
    const compiled = Number(cells.D);
    strata.set(String(cells.A).padStart(8, "0"), {
      geometric: String(cells.B), mesh: String(cells.C), compiled,
      difficulty: compiled >= EASY_FROM ? "Easy" : "Hard",
    });
  }
  return strata;
}

/**
 * Reads the stratification spreadsheet with the system unzip.
 * @param {string} xlsx Path to Data_Stratification.xlsx.
 * @returns {Map<string, Strata> | null} null when the file or unzip is missing;
 *   the run then reports unstratified and says so.
 */
export function readStrata(xlsx) {
  if (!fs.existsSync(xlsx)) return null;
  try {
    const part = (/** @type {string} */ name) => execFileSync("unzip", ["-p", xlsx, name], { encoding: "utf8" });
    return parseStrata(part("xl/sharedStrings.xml"), part("xl/worksheets/sheet1.xml"));
  } catch {
    return null;
  }
}

/** @typedef {{ id: string, variant: "measured" | "abstract", prompt: string,
 *   rewrite: "scaled" | "fallback" | "none", suspect: boolean, gtStlPath: string,
 *   gtJson: any, strata: Strata | null }} Sample */

/**
 * Loads every sample of one prompt variant, sorted by id.
 * @param {string} dir Dataset checkout (holds CADPrompt/ and the xlsx).
 * @param {"measured" | "abstract"} variant
 * @returns {Sample[]}
 */
export function loadSamples(dir, variant) {
  const root = path.join(dir, "CADPrompt");
  const strata = readStrata(path.join(dir, "Data_Stratification.xlsx"));
  const file = variant === "measured" ? MEASURED_FILE : ABSTRACT_FILE;
  return fs.readdirSync(root).filter((n) => /^\d+$/.test(n)).sort().map((id) => {
    const d = path.join(root, id);
    const { prompt, rewrite, suspect } = rewritePrompt(fs.readFileSync(path.join(d, file), "utf8"), variant);
    return {
      id, variant, prompt, rewrite, suspect,
      gtStlPath: path.join(d, "Ground_Truth.stl"),
      gtJson: JSON.parse(fs.readFileSync(path.join(d, "Ground_Truth.json"), "utf8")).Ground_Truth,
      strata: strata?.get(id) ?? null,
    };
  });
}

/**
 * Ensures the pinned dataset is checked out in dir; the only network access.
 * @param {string} [dir]
 * @returns {string} dir
 * @throws {Error} When the checkout does not end at the pin.
 */
export function fetchCadPrompt(dir = CADPROMPT_DIR) {
  const head = () => {
    try {
      return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  if (head() === CADPROMPT_PIN) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["init", "-q", dir]);
  // GitHub serves fetch-by-SHA, so a shallow fetch of exactly the pin works.
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", CADPROMPT_REPO, CADPROMPT_PIN], { stdio: "inherit" });
  execFileSync("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"]);
  if (head() !== CADPROMPT_PIN) throw new Error("CADPrompt checkout is not at " + CADPROMPT_PIN);
  return dir;
}
