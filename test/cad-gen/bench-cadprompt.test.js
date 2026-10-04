import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSamples, parseStrata, rewritePrompt } from "../../scripts/lib/cadprompt.mjs";

describe("rewritePrompt (measured)", () => {
  it("strips the CadQuery prefix and scales 'N units' to mm", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a 3D model by extruding a circular sketch. " +
      "The circle should have a radius of 0.75 units and the extrusion should be 0.20923 units high.", "measured");
    expect(out.prompt).toBe("Create a 3D model by extruding a circular sketch. The circle should have a radius of " +
      "75 mm and the extrusion should be 20.923 mm high. Dimensions are in millimetres.");
    expect(out).toMatchObject({ rewrite: "scaled", suspect: false });
  });

  it("scales every member of an 'A by B units' list", () => {
    expect(rewritePrompt("Write Python code using CADQuery to create a rectangle with dimensions 0.0075 by 0.750037 units.",
      "measured").prompt).toContain("0.75 by 75.0037 mm");
  });

  it("leaves degrees, meters, ratios and counts alone", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a plate 0.5 units wide with 4 holes, " +
      "0.61135 meters long, about 1.5 times its width, rotated by -90 degrees.", "measured");
    expect(out.prompt).toContain("50 mm wide with 4 holes, 0.61135 meters long, about 1.5 times its width, rotated by -90 degrees");
    expect(out.rewrite).toBe("scaled");
  });

  it("handles the observed prefix variants", () => {
    expect(rewritePrompt("Write a Python script using CADQuery to create a cube of 1 unit.", "measured").prompt)
      .toBe("Create a cube of 100 mm. Dimensions are in millimetres.");
    expect(rewritePrompt("Write Python code using CADQuery for a 3D model that looks like a workbench.", "abstract").prompt)
      .toBe("Create a 3D model that looks like a workbench. Dimensions are in millimetres.");
  });

  it("falls back, unscaled, when coordinates carry lengths", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a parallelogram defined by the points " +
      "[(0.6147, 0), (1.500795, 0)] extruded by 0.1 units.", "measured");
    expect(out.rewrite).toBe("fallback");
    expect(out.suspect).toBe(true);
    expect(out.prompt).toContain("(0.6147, 0)");
    expect(out.prompt).toContain("extruded by 0.1 units");
    expect(out.prompt).toContain("1 unit = 100 mm");
  });

  it("falls back when a unit number is the tail of an expression", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create rectangles 0.636792 + 0.113207*2 units long.", "measured");
    expect(out.rewrite).toBe("fallback");
    expect(out.prompt).not.toContain("*200");
  });
});

describe("rewritePrompt (abstract)", () => {
  it("only strips the prefix", () => {
    expect(rewritePrompt(" write a python code using CADQuery to create an extruded sketch of a circle.", "abstract"))
      .toEqual({ prompt: "Create an extruded sketch of a circle. Dimensions are in millimetres.", rewrite: "none", suspect: false });
  });
});

describe("parseStrata", () => {
  const shared = '<sst><si><t>ID</t></si><si><t>Simple</t></si><si><t>Moderate</t></si>' +
    '<si><t xml:space="preserve"> Complex</t></si></sst>';
  const sheet = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2"><v>7</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>3</v></c><c r="D2"><v>6</v></c></row>' +
    '<row r="3"><c r="A3"><v>633</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>1</v></c><c r="D3"><v>3</v></c></row>' +
    '</sheetData>';

  it("keys by 8-digit id, trims labels, and splits difficulty at 4 of 6", () => {
    const strata = parseStrata(shared, sheet);
    expect(strata.get("00000007")).toEqual({ geometric: "Simple", mesh: "Complex", compiled: 6, difficulty: "Easy" });
    expect(strata.get("00000633")).toEqual({ geometric: "Moderate", mesh: "Simple", compiled: 3, difficulty: "Hard" });
    expect(strata.size).toBe(2);
  });
});

describe("loadSamples", () => {
  it("loads samples from a CADPrompt-shaped directory without strata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cadprompt-"));
    for (const id of ["00000002", "00000001"]) {
      const d = path.join(dir, "CADPrompt", id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "Natural_Language_Descriptions_Prompt.txt"), "write python code using CADQuery to create a cube.");
      fs.writeFileSync(path.join(d, "Natural_Language_Descriptions_Prompt_with_specific_measurements.txt"),
        "Write Python code using CADQuery to create a cube of 0.5 units.");
      fs.writeFileSync(path.join(d, "Ground_Truth.json"), JSON.stringify({ Ground_Truth: { Width_mm: 0.5 } }));
      fs.writeFileSync(path.join(d, "Ground_Truth.stl"), "solid x\nendsolid x\n");
    }
    const samples = loadSamples(dir, "measured");
    expect(samples.map((s) => s.id)).toEqual(["00000001", "00000002"]);
    expect(samples[0]).toMatchObject({
      variant: "measured", rewrite: "scaled", suspect: false, strata: null,
      gtJson: { Width_mm: 0.5 }, gtStlPath: path.join(dir, "CADPrompt", "00000001", "Ground_Truth.stl"),
    });
    expect(samples[0].prompt).toBe("Create a cube of 50 mm. Dimensions are in millimetres.");
  });
});
