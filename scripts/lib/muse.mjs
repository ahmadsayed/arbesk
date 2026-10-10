/**
 * The MUSE text-to-CAD benchmark dataset: pinned download, case loading, spec fields.
 * @remarks MUSE (Dong, Li & Wu, arXiv 2605.28579) ships 106 cases on Hugging
 *   Face under CC BY 4.0. Each case is a design specification, a six-category
 *   rubric and a reference 4-view drawing - no reference geometry, so the
 *   benchmark is judged rather than measured. Downloads are pinned to one
 *   dataset commit so a later edit upstream cannot silently change the score,
 *   and land in gitignored test-results/ like CADPrompt's data.
 */
import fs from "node:fs";
import path from "node:path";

/** Dataset commit every download is pinned to (2026-05-28). */
export const MUSE_REVISION = "f8a1dc45d1ea73df4161e8a1caf1d503c5358c30";

/**
 * @typedef {{ method: "cnc" | "print" | "laser" | "other", material: string,
 *   components: number | null }} Strata
 * @typedef {{ id: string, spec: string, rubric: string, referencePng: string,
 *   strata: Strata }} Case
 */

/**
 * @param {string} relPath Path inside the dataset repo.
 * @returns {string} The pinned download URL.
 */
export function museUrl(relPath) {
  return "https://huggingface.co/datasets/dongxiaoyu/MUSE/resolve/" + MUSE_REVISION + "/" + relPath;
}

/**
 * The text under one `## Heading` of a spec, trimmed.
 * @param {string} markdown @param {string} heading
 * @returns {string} Empty when the section is absent.
 */
function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## " + heading);
  if (start < 0) return "";
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * The spec fields the report groups cases by.
 * @remarks The method is folded into four buckets because the dataset spells
 *   3D printing two ways ("3D Printing", "FDM 3D Printing").
 * @param {string} markdown A case's design_description.md.
 * @returns {{ method: Strata["method"], methodRaw: string, material: string,
 *   components: number | null }}
 */
export function parseSpec(markdown) {
  const methodRaw = section(markdown, "Manufacturing Method").split("\n")[0].trim();
  const lower = methodRaw.toLowerCase();
  const method = lower.includes("print") ? "print"
    : lower.includes("cnc") ? "cnc"
      : lower.includes("laser") ? "laser" : "other";
  const material = section(markdown, "Material").split("\n")[0].trim();
  const qty = Number.parseInt(section(markdown, "Planned Component Quantity"), 10);
  return { method, methodRaw, material, components: Number.isFinite(qty) ? qty : null };
}

/**
 * @param {string} root Dataset directory.
 * @returns {any[]} metadata.jsonl rows, in file order.
 */
function readMetadata(root) {
  return fs.readFileSync(path.join(root, "metadata.jsonl"), "utf8")
    .split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Every file a case needs, as dataset-relative paths.
 * @param {any} row One metadata.jsonl row.
 * @returns {string[]}
 */
const caseFiles = (row) => [row.design_description, row.evaluation_rubric, row.svg_png];

/**
 * Downloads the dataset into root, skipping files already present.
 * @param {string} root Destination directory.
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<void>}
 * @throws {Error} Naming the URL of any download that is not a 200.
 */
export async function fetchMuse(root, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  /** @param {string} rel */
  const get = async (rel) => {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return;
    const url = museUrl(rel);
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error("MUSE download failed (" + res.status + "): " + url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  };
  await get("metadata.jsonl");
  for (const row of readMetadata(root)) {
    for (const rel of caseFiles(row)) await get(rel);
  }
}

/**
 * Loads every case, in metadata order.
 * @remarks Checks every file up front: a case missing its rubric must stop the
 *   run before any DeepSeek or Gemini call is paid for, not halfway through.
 * @param {string} root Dataset directory.
 * @returns {Case[]}
 * @throws {Error} Naming the first missing file.
 */
export function loadCases(root) {
  return readMetadata(root).map((row) => {
    for (const rel of caseFiles(row)) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) throw new Error("MUSE case file missing: " + file);
    }
    const spec = fs.readFileSync(path.join(root, row.design_description), "utf8");
    const { method, material, components } = parseSpec(spec);
    return {
      id: row.case_id,
      spec,
      rubric: fs.readFileSync(path.join(root, row.evaluation_rubric), "utf8"),
      referencePng: path.join(root, row.svg_png),
      strata: { method, material, components },
    };
  });
}
