/**
 * The run's own HTML report: a gallery per variant, plus an overview at the root.
 * @remarks The harness writes summary.md for the numbers and this for the EYES:
 *   every sample's prompt, its part next to the ground truth through the same
 *   renderer, its metrics and its triage, all from the records already on disk.
 *   Self-contained - inline styles, no CDN, no script - so it opens from a
 *   file:// URL next to the data it describes. Image and file links are all
 *   relative within the run directory on purpose: a path segment containing "#"
 *   would be read as a fragment by the browser and render nothing.
 */
import fs from "node:fs";
import path from "node:path";

const CSS = [
  "body{margin:0;background:#fbfcfd;color:#1c1f23;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
  ".wrap{max-width:1180px;margin:0 auto;padding:32px 22px 70px}h1{font-size:25px;margin:0 0 6px}",
  "h2{font-size:18px;margin:34px 0 10px;border-bottom:1px solid #e3e7ec;padding-bottom:6px}",
  ".sub{color:#5b6470;margin:0 0 8px}a{color:#2f6f4f}",
  ".chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}",
  ".chip{background:#fff;border:1px solid #e3e7ec;border-radius:999px;padding:3px 10px;font-size:12.5px;color:#5b6470}",
  ".chip b{color:#1c1f23}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}",
  "th,td{padding:6px 9px;border-bottom:1px solid #e3e7ec;text-align:right}",
  "th:first-child,td:first-child{text-align:left}th:nth-child(2),td:nth-child(2){text-align:left}",
  "thead th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#5b6470}",
  ".badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11.5px;font-weight:600}",
  ".built{background:#eaf4ee;color:#2f6f4f}.gate_failed{background:#fdecec;color:#a33}",
  ".kernel_error{background:#fff3e0;color:#8a5a00}.refused{background:#eef1f4;color:#5b6470}",
  ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:14px;margin-top:12px}",
  ".part{background:#fff;border:1px solid #e3e7ec;border-radius:10px;padding:12px 14px}",
  ".part h3{margin:0 0 8px;font-size:14px}.imgs{display:flex;gap:10px}figure{margin:0;flex:1}",
  "img{width:100%;border:1px solid #e3e7ec;border-radius:6px;background:#fff}",
  "figcaption{color:#5b6470;font-size:11.5px;margin-top:3px}",
  ".none{flex:1;display:flex;align-items:center;justify-content:center;height:120px;border:1px dashed #d8b4b4;border-radius:6px;color:#a33;font-size:12.5px;text-align:center;background:#fdf7f7;padding:6px}",
  "pre{background:#f4f6f8;border:1px solid #e3e7ec;border-radius:6px;padding:8px 10px;white-space:pre-wrap;font-size:12.5px;margin:10px 0 4px;max-height:120px;overflow:auto}",
  ".meta{font-size:12.5px;color:#5b6470;margin:2px 0}.files{font-size:12px;margin:6px 0 0}",
  "code{background:#eef1f4;border-radius:4px;padding:1px 4px}",
  "footer{margin-top:40px;color:#5b6470;font-size:13px;border-top:1px solid #e3e7ec;padding-top:14px}",
  "@media (prefers-color-scheme:dark){body{background:#14181c;color:#e8ecf1}.sub,.meta,figcaption,.chip,thead th,footer{color:#9aa6b2}",
  ".chip,.part{background:#1b2026;border-color:#2b3238}.chip b{color:#e8ecf1}th,td,h2,footer{border-color:#2b3238}",
  "pre{background:#232a31;border-color:#2b3238}img{border-color:#2b3238;background:#232a31}a{color:#63b98b}",
  "code{background:#232a31}.built{background:#1c2a24;color:#63b98b}.gate_failed{background:#2e1d1d;color:#e58a8a}",
  ".kernel_error{background:#2e2616;color:#d8ab54}.refused{background:#232a31;color:#9aa6b2}",
  ".none{background:#241b1b;border-color:#5a3a3a;color:#e58a8a}}",
].join("");

/** HTML-escapes text from a record, so a prompt full of angle brackets cannot break the page. */
function esc(v) {
  return String(v === undefined || v === null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const f3 = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(3) : "-");
const pct = (x) => (typeof x === "number" && Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "-");
const mi = (m) => (m && Number.isFinite(m.median) ? f3(m.median) + " (" + f3(m.iqr) + ")" : "-");

/** Every sample record in a directory, in id order. */
function readSamples(dir) {
  return fs.readdirSync(dir).filter((f) => /^\d{8}\.json$/.test(f)).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/** The gate (or error) that stopped a sample, for the table and the card. */
function whyFailed(sample) {
  const failures = sample.clientFailures || [];
  if (failures.length) return failures[failures.length - 1].gate;
  if (sample.error) return String(sample.error).slice(0, 60);
  return "";
}

/** One card: prompt, part against ground truth, metrics, links. */
function card(sample) {
  const id = sample.id;
  const metrics = sample.metrics || {};
  const stats = sample.stats || null;
  const design = sample.design || {};
  const triage = sample.triage || {};
  const labels = [triage.failureCause && triage.failureCause.label, triage.shapeMismatch && triage.shapeMismatch.label]
    .filter(Boolean);
  const iou = metrics.iou === null || metrics.iou === undefined ? "n/a" : f3(metrics.iou);
  const size = stats
    ? [0, 1, 2].map((a) => (stats.bboxMm.max[a] - stats.bboxMm.min[a]).toFixed(1)).join(" x ") + " mm"
    : "";
  const part = stats
    ? "<figure><a href='" + id + ".generated.png'><img loading='lazy' src='" + id + ".generated.png' alt='cad-gen output for " + id + "'></a><figcaption>cad-gen &mdash; " + size + "</figcaption></figure>"
    : "<div class=none>no part delivered<br>(" + esc(sample.outcome + (whyFailed(sample) ? ": " + whyFailed(sample) : "")) + ")</div>";

  return "<section class=part id='p" + id + "'>"
    + "<h3>" + id + " &middot; <span class='badge " + esc(sample.outcome) + "'>" + esc(sample.outcome) + "</span> &middot; IoU " + iou + "</h3>"
    + "<div class=imgs>" + part
    + "<figure><a href='../truth/" + id + ".png'><img loading='lazy' src='../truth/" + id + ".png' alt='ground truth for " + id + "'></a><figcaption>CADPrompt ground truth</figcaption></figure></div>"
    + "<pre>" + esc(sample.prompt) + "</pre>"
    + "<p class=meta>"
    + (stats ? "triangles " + stats.triangles + " &middot; bodies " + ((stats.bodies && stats.bodies.count) || 1) + " &middot; " : "")
    + "turn " + (design.turn || 1) + " &middot; " + ((sample.durationMs || 0) / 1000).toFixed(1) + " s"
    + (labels.length ? " &middot; triage: " + esc(labels.join(", ")) : "")
    + (sample.error && sample.outcome !== "built" ? " &middot; " + esc(String(sample.error).slice(0, 90)) : "")
    + "</p>"
    + "<p class=files><a href='" + id + ".prompt.txt'>prompt.txt</a>"
    + (stats ? " &middot; <a href='" + id + ".stl'>stl</a>" : "")
    + (design.code ? " &middot; <a href='" + id + ".design.mjs'>design.mjs</a>" : "")
    + " &middot; <a href='" + id + ".json'>json</a></p></section>";
}

/**
 * Writes one variant's gallery.
 * @param {string} dir The variant directory (holds the records and the images).
 * @param {any} summary Its summary.json.
 * @returns {string} The path written.
 */
export function writeVariantReport(dir, summary) {
  const samples = readSamples(dir);
  const config = summary.config || {};
  const overall = summary.overall || {};
  const chips = [
    ["model", config.model], ["thinking", config.thinking ? "on" : "off"],
    ["Jev selector", config.jev === false ? "off" : "on"], ["server repair attempts", config.maxRepairAttempts],
    ["surface samples", config.samples], ["seed", config.seed], ["dataset", config.dataset],
  ].filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => "<span class=chip>" + esc(k) + ": <b>" + esc(v) + "</b></span>").join("");

  const header = "<h1>CADPrompt &mdash; " + esc(config.variant || "variant") + " prompts (" + samples.length + " samples)</h1>"
    + "<div class=chips>" + chips + "</div>"
    + "<p class=sub>Compile " + pct(overall.compileRate) + " &middot; first pass " + pct(overall.firstPassRate)
    + " &middot; IoGT " + mi(overall.iogt) + " &middot; PC dist " + mi(overall.chamfer)
    + " &middot; Hausdorff " + mi(overall.hausdorff) + " &middot; exact IoU " + mi(overall.iou) + ".</p>"
    + "<p class=sub>Each card shows the delivered part beside the CADPrompt ground truth, both through the repo's own renderer at the same camera, so the comparison is of parts and not pictures. Sizes are in the captions, never in the pictures: the camera fits each mesh.</p>";

  const rows = samples.map((s) => {
    const m = s.metrics || {};
    return "<tr><td><a href='#p" + s.id + "'>" + s.id + "</a></td>"
      + "<td><span class='badge " + esc(s.outcome) + "'>" + esc(s.outcome) + "</span></td>"
      + "<td>" + (m.iou === null || m.iou === undefined ? "n/a" : f3(m.iou)) + "</td>"
      + "<td>" + f3(m.iogt) + "</td><td>" + f3(m.chamfer) + "</td><td>" + f3(m.hausdorff) + "</td>"
      + "<td>" + esc(whyFailed(s)) + "</td></tr>";
  }).join("");

  const outcomes = Object.keys(summary.outcomes || {})
    .map((k) => "<tr><td>" + esc(k) + "</td><td>" + summary.outcomes[k] + "</td></tr>").join("");
  const gates = Object.keys(summary.failedGates || {})
    .map((k) => "<tr><td>" + esc(k) + "</td><td>" + summary.failedGates[k] + "</td></tr>").join("");
  const bands = Object.keys(summary.byComplexity || {})
    .map((k) => {
      const b = summary.byComplexity[k];
      return "<tr><td>" + esc(k) + "</td><td>" + b.n + "</td><td>" + pct(b.compileRate) + "</td><td>" + mi(b.iou) + "</td></tr>";
    }).join("");

  const html = "<!doctype html><html lang='en'><meta charset='utf-8'>"
    + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    + "<title>CADPrompt " + esc(config.variant || "") + " &mdash; " + samples.length + " samples</title>"
    + "<style>" + CSS + "</style><div class=wrap>" + header
    + "<h2>Every sample</h2><table><thead><tr><th>id</th><th>outcome</th><th>IoU</th><th>IoGT</th><th>PC dist</th><th>Hausdorff</th><th>gate / error</th></tr></thead><tbody>"
    + rows + "</tbody></table>"
    + "<h2>Outcomes</h2><table><thead><tr><th>outcome</th><th>count</th></tr></thead><tbody>" + outcomes + "</tbody></table>"
    + (gates ? "<h2>Failing gates</h2><table><thead><tr><th>gate</th><th>samples</th></tr></thead><tbody>" + gates + "</tbody></table>" : "")
    + (bands ? "<h2>By complexity (Jev)</h2><table><thead><tr><th>band</th><th>n</th><th>compile</th><th>IoU median (IQR)</th></tr></thead><tbody>" + bands + "</tbody></table>" : "")
    + "<h2>Parts</h2><div class=grid>" + samples.map(card).join("") + "</div>"
    + "<footer>Written by the run itself from its own records: <code>summary.json</code> and one <code>&lt;id&gt;.json</code> per sample. "
    + "The images are <code>&lt;id&gt;.generated.png</code> here and <code>../truth/&lt;id&gt;.png</code>.</footer>"
    + "</div></html>";

  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  return file;
}


/**
 * Writes a sample's text artifacts: the prompt as sent, the request it came from,
 * and the script cad-gen wrote.
 * @remarks These exist for the reader, not the pipeline: the prompt is the thing
 *   every number in the run is an answer to, and the design is what to open when a
 *   part is wrong. The original dataset prompts are read from the request's own
 *   directory (the ground-truth STL's neighbour) so both prompt variants travel
 *   with the result instead of staying in the dataset.
 * @param {string} dir The variant directory.
 * @param {any} sample @param {any} result The sample's record.
 */
export function writeSampleText(dir, sample, result) {
  const requestDir = sample.gtStlPath ? path.dirname(sample.gtStlPath) : null;
  const read = (name) => {
    if (!requestDir) return "(dataset file not available)";
    try {
      return fs.readFileSync(path.join(requestDir, name), "utf8").trim();
    } catch {
      return "(dataset file not available)";
    }
  };
  const gt = (sample.gtJson && sample.gtJson.Ground_Truth) || sample.gtJson || {};
  const metrics = result.metrics || {};
  const stats = result.stats || null;
  const design = result.design || {};
  const triage = result.triage || {};
  const labels = [triage.failureCause && triage.failureCause.label, triage.shapeMismatch && triage.shapeMismatch.label]
    .filter(Boolean);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(3) : "n/a");
  const lines = [
    "Sample " + sample.id + " - CADPrompt benchmark, " + sample.variant + " variant",
    "=".repeat(72), "",
    "PROMPT AS SENT TO cad-gen (after the rewrite)", "-".repeat(72),
    String(result.prompt || sample.prompt || ""), "",
    "ORIGINAL DATASET PROMPT (measured variant)", "-".repeat(72), read("Natural_Language_Descriptions_Prompt_with_specific_measurements.txt"), "",
    "ORIGINAL DATASET PROMPT (abstract variant)", "-".repeat(72), read("Natural_Language_Descriptions_Prompt.txt"), "",
    "REWRITE: " + String(result.rewrite) + "   SUSPECT: " + String(result.suspect), "",
    "GROUND TRUTH (as published by CADPrompt; dataset units, x100 = mm)", "-".repeat(72),
    "  size (dataset units): " + num(gt.Width_mm) + " x " + num(gt.Height_mm) + " x " + num(gt.Depth_mm),
    "  volume (mm3, x1e6):    " + num((gt.Volume_cubic_mm || 0) * 1e6),
    "  faces / vertices:     " + String(gt.Number_of_Faces) + " / " + String(gt.Number_of_Vertices),
    "  solid:                " + String(gt.Is_Solid), "",
    "RESULT", "-".repeat(72),
    "  outcome:        " + String(result.outcome) + (result.firstPass ? "" : "  (needed a repair round)"),
    "  exact IoU:      " + num(metrics.iou),
    "  IoGT:           " + num(metrics.iogt),
    "  chamfer (PC):   " + num(metrics.chamfer),
    "  Hausdorff:      " + num(metrics.hausdorff),
    "  generated size: " + (stats
      ? [0, 1, 2].map((a) => (stats.bboxMm.max[a] - stats.bboxMm.min[a]).toFixed(2)).join(" x ") + " mm"
      : "n/a (no part delivered)"),
    "  triangles:      " + String(stats ? stats.triangles : "n/a") + "   bodies: " + String(stats && stats.bodies ? stats.bodies.count : "n/a"),
    "  duration:       " + ((result.durationMs || 0) / 1000).toFixed(1) + " s",
    "  tokens:         deepseek " + ((result.tokens && result.tokens.prompt) || 0) + " in / " + ((result.tokens && result.tokens.completion) || 0) + " out",
    "  design summary: " + String(design.summary || "n/a") + "   (turn " + String(design.turn || 1) + ")",
  ];
  if (result.error) lines.push("  error:          " + String(result.error).slice(0, 500));
  lines.push("  jev complexity: " + JSON.stringify(result.complexity || null));
  lines.push("  jev triage:     " + (labels.length ? JSON.stringify(labels) : "not triaged (scored well)"));
  lines.push("", "FILES (this directory)", "-".repeat(72));
  if (stats) lines.push("  " + sample.id + ".stl                 mesh cad-gen delivered");
  lines.push("  " + sample.id + ".generated.png       render of the delivered mesh" + (stats ? "" : " (absent when no part was delivered)"));
  lines.push("  ../truth/" + sample.id + ".png      render of the CADPrompt ground truth (same renderer)");
  if (design.code) lines.push("  " + sample.id + ".design.mjs          the script cad-gen wrote");
  lines.push("  " + sample.id + ".json              the full record");
  fs.writeFileSync(path.join(dir, sample.id + ".prompt.txt"), lines.join("\n") + "\n");
  if (design.code) fs.writeFileSync(path.join(dir, sample.id + ".design.mjs"), design.code + "\n");
}

/**
 * Writes the run overview that links the variant galleries.
 * @param {string} runDir The run directory (run#N).
 * @param {[string, any][]} variants Pairs of variant name and its summary.
 * @returns {string} The path written.
 */
export function writeRunOverview(runDir, variants) {
  const rows = variants.map(([name, summary]) => {
    const o = (summary && summary.overall) || {};
    const config = (summary && summary.config) || {};
    return "<tr><td><a href='" + esc(name) + "/index.html'>" + esc(name) + "</a></td><td>" + (o.n || 0) + "</td>"
      + "<td>" + pct(o.compileRate) + "</td><td>" + pct(o.firstPassRate) + "</td><td>" + mi(o.iou) + "</td>"
      + "<td>" + esc(config.model || "") + "</td></tr>";
  }).join("");
  const template = (variants[0] && variants[0][1] && variants[0][1].config) || {};
  const html = "<!doctype html><html lang='en'><meta charset='utf-8'>"
    + "<meta name='viewport' content='width=device-width,initial-scale=1'><title>CADPrompt run</title>"
    + "<style>" + CSS + "</style><div class=wrap>"
    + "<h1>CADPrompt run</h1>"
    + "<div class=chips><span class=chip>model: <b>" + esc(template.model || "") + "</b></span>"
    + "<span class=chip>thinking: <b>" + (template.thinking ? "on" : "off") + "</b></span>"
    + "<span class=chip>dataset: <b>" + esc(template.dataset || "") + "</b></span>"
    + "<span class=chip>seed: <b>" + esc(template.seed || "") + "</b></span></div>"
    + "<table><thead><tr><th>variant</th><th>samples</th><th>compile</th><th>first pass</th><th>IoU median (IQR)</th><th>model</th></tr></thead><tbody>"
    + rows + "</tbody></table>"
    + "<p class=sub>The galleries below carry every sample: prompt, part against ground truth, metrics, triage, and links to the mesh, the prompt and the full record.</p>"
    + "</div></html>";
  const file = path.join(runDir, "index.html");
  fs.writeFileSync(file, html);
  return file;
}
