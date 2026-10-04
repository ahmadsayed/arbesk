import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeRunOverview, writeSampleText, writeVariantReport } from "../../scripts/lib/bench-report.mjs";

/** A variant directory as the run leaves it: summary.json plus per-sample records. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-report-"));
  const dir = path.join(root, "measured");
  fs.mkdirSync(path.join(root, "truth"), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const sample = (id, over = {}) => ({
    id, variant: "measured", prompt: "a rod 75 mm long", rewrite: "scaled", suspect: false,
    outcome: "built", firstPass: true, error: null, clientFailures: [],
    metrics: { chamfer: 0.02, hausdorff: 0.1, iogt: 1, iou: 0.99, iouReason: null },
    stats: { triangles: 100, vertices: 60, volumeMm3: 1000, bboxMm: { min: [0, 0, 0], max: [75, 6.25, 6.25] }, bodies: { count: 1, boxes: [] } },
    design: { code: "return box(1,1,1);", parameters: {}, summary: "a rod", turn: 1 },
    diagnostics: { selection: { libraries: [], fit: {}, source: "jev", expectedPieces: 1, piecesSeparate: 0.06 } },
    triage: null, complexity: { score: 1, confidence: 0.9, usage: { prompt: 10, completion: 1 } },
    tokens: { prompt: 100, completion: 10 }, jevTokens: { prompt: 5, completion: 0 }, durationMs: 4000,
    ...over,
  });
  fs.writeFileSync(path.join(dir, "00000007.json"), JSON.stringify(sample("00000007")));
  fs.writeFileSync(path.join(dir, "00002221.json"), JSON.stringify(sample("00002221", {
    outcome: "gate_failed", firstPass: false, metrics: { chamfer: 1.732, hausdorff: 1.732, iogt: 0, iou: 0, iouReason: null },
    stats: null, design: null,
    clientFailures: [{ gate: "connected", error: "connected: the part is 2 separate bodies" }],
    triage: { failureCause: { label: "degenerate_boolean", confidence: 0.59, unsure: true }, usage: { prompt: 50, completion: 0 } },
    complexity: null, error: "connected: the part is 2 separate bodies",
  })));
  const summary = {
    config: { variant: "measured", model: "deepseek-flash", thinking: false, jev: true, dataset: "33dcecd", maxRepairAttempts: 3, samples: 8192, seed: 1 },
    overall: { n: 2, compileRate: 0.5, firstPassRate: 0.5, iogt: { median: 1, iqr: 0, n: 2 }, chamfer: { median: 0.02, iqr: 0.02, n: 2 }, hausdorff: { median: 0.1, iqr: 0.1, n: 2 }, iou: { median: 0.99, iqr: 0.9, n: 2 }, iouUnavailable: 0 },
    outcomes: { built: 1, gate_failed: 1 }, failedGates: { connected: 1 }, wrongRefusals: [],
    byComplexity: { "a few features or operations": { n: 1, compileRate: 1, firstPassRate: 1, iou: { median: 0.99, iqr: 0, n: 1 } } },
    complexityUnscored: 1, cost: { deepseek: { prompt: 200, completion: 20 }, jev: { prompt: 60, completion: 0 }, durationMs: 4000 },
  };
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary));
  return { root, dir, summary };
}

describe("writeVariantReport", () => {
  it("writes a gallery that names every sample and points at its images and files", () => {
    const { dir, summary } = fixture();
    const file = writeVariantReport(dir, summary);
    const html = fs.readFileSync(file, "utf8");
    expect(file).toBe(path.join(dir, "index.html"));
    expect(html).toContain("00000007");
    expect(html).toContain("00002221");
    expect(html).toContain("00000007.generated.png");
    expect(html).toContain("../truth/00000007.png");
    expect(html).toContain("00000007.prompt.txt");
    expect(html).toContain("connected");           // the gate that failed
    expect(html).toContain("50.0%");               // the compile rate
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("marks a sample with no delivered part instead of linking a missing image", () => {
    const { dir, summary } = fixture();
    const html = fs.readFileSync(writeVariantReport(dir, summary), "utf8");
    expect(html).toContain("no part delivered");
    expect(html).not.toContain("00002221.generated.png");
  });
});

describe("writeRunOverview", () => {
  it("links the variant galleries from the run root", () => {
    const { root, summary } = fixture();
    const file = writeRunOverview(root, [["measured", summary]]);
    const html = fs.readFileSync(file, "utf8");
    expect(file).toBe(path.join(root, "index.html"));
    expect(html).toContain("measured/index.html");
    expect(html).toContain("deepseek-flash");
    expect(html).not.toContain("undefined");
  });
});

describe("writeSampleText", () => {
  it("writes the prompt as sent, the dataset prompts and the script", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-text-"));
    const dir = path.join(root, "measured");
    const req = path.join(root, "CADPrompt", "00000007");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(req, { recursive: true });
    fs.writeFileSync(path.join(req, "Natural_Language_Descriptions_Prompt_with_specific_measurements.txt"), "a rod 0.75 units long");
    fs.writeFileSync(path.join(req, "Natural_Language_Descriptions_Prompt.txt"), "a rod");
    const sample = {
      id: "00000007", variant: "measured", prompt: "a rod 75 mm long", rewrite: "scaled", suspect: false,
      gtJson: { Ground_Truth: { Width_mm: 0.75, Height_mm: 0.0625, Depth_mm: 0.0625, Volume_cubic_mm: 0.003, Is_Solid: true, Number_of_Faces: 20, Number_of_Vertices: 12 } },
      gtStlPath: path.join(req, "Ground_Truth.stl"),
    };
    const result = {
      prompt: "a rod 75 mm long", rewrite: "scaled", suspect: false, outcome: "built", firstPass: true,
      metrics: { iou: 0.99, iogt: 1, chamfer: 0.02, hausdorff: 0.1 },
      stats: { triangles: 100, bodies: { count: 1 }, bboxMm: { min: [0, 0, 0], max: [75, 6.25, 6.25] } },
      design: { code: "return box(1,1,1);", summary: "a rod", turn: 1 },
      tokens: { prompt: 100, completion: 10 }, durationMs: 4000, complexity: { score: 1 }, triage: null,
    };
    writeSampleText(dir, sample, result);
    const txt = fs.readFileSync(path.join(dir, "00000007.prompt.txt"), "utf8");
    expect(txt).toContain("a rod 75 mm long");
    expect(txt).toContain("a rod 0.75 units long");
    expect(txt).toContain("REWRITE: scaled");
    expect(txt).toContain("0.990");
    expect(txt).toContain("not triaged");
    expect(fs.readFileSync(path.join(dir, "00000007.design.mjs"), "utf8")).toBe("return box(1,1,1);\n");
  });
});
