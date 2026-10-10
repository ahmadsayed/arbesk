import { describe, expect, test, beforeAll } from "bun:test";
import path from "node:path";
import { renderCadDesign, CadRenderError } from "../../frontend/src/js/workers/cad-render-core.ts";
import { parse3mfModel } from "@arbesk/asset-core/formats/3mf/parser.js";
import { parsed3mfToGltf } from "@arbesk/asset-core/formats/3mf/to-gltf.js";
import { unzipSync, strFromU8 } from "fflate";

const DESIGN = {
  code: "return box(P.width, P.depth, P.height);",
  parameters: {
    width: { value: 40, unit: "mm", min: 10, max: 200, label: "Width" },
    depth: { value: 30, unit: "mm", min: 10, max: 200, label: "Depth" },
    height: { value: 20, unit: "mm", min: 5, max: 100, label: "Height" },
  },
  summary: "A 40x30x20 box",
};

let module_;
beforeAll(async () => {
  const Module = (await import("manifold-3d")).default;
  // Repo-root resolution keeps this independent of the test file's depth.
  module_ = await Module({
    locateFile: (f) => path.join(process.cwd(), "node_modules", "manifold-3d", f),
  });
  module_.setup();
});

describe("renderCadDesign", () => {
  test("renders an array return as one 3MF object per part", () => {
    const twoPart = {
      ...DESIGN,
      code: "return [box(P.width, P.depth, P.height), box(P.width, P.depth, P.height).translate([P.width, 0, 0])];",
    };
    const { bytes, stats } = renderCadDesign(twoPart, module_);
    expect(stats.parts.count).toBe(2);
    const entries = unzipSync(bytes);
    const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
    const parsed = parse3mfModel(strFromU8(entries[modelPath]));
    expect(parsed.objects.length).toBe(2);
  });

  test("renders a valid design to parseable 3MF with geometry", () => {
    const { bytes, summary, stats } = renderCadDesign(DESIGN, module_);
    expect(bytes.length).toBeGreaterThan(500);
    expect(summary).toBe(DESIGN.summary);
    expect(stats && typeof stats === "object").toBe(true);
    const entries = unzipSync(bytes);
    const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
    const parsed = parse3mfModel(strFromU8(entries[modelPath]));
    expect(parsed.objects[0].vertices.length).toBeGreaterThan(0);
    expect(parsed.objects[0].triangles.length).toBeGreaterThan(0);
    const gltf = parsed3mfToGltf(parsed);
    expect(gltf.meshes.length).toBe(1);
    // design sidecar embedded
    expect(Object.keys(entries)).toContain("Metadata/arbesk_cad.json");
  });

  test("rejects on prelude version mismatch", () => {
    expect(() => renderCadDesign(DESIGN, module_, { preludeVersion: "1999-01-01.0" }))
      .toThrowError(expect.objectContaining({ code: "CAD_PRELUDE_MISMATCH" }));
  });

  test("rejects a design that fails the guard", () => {
    const evil = { ...DESIGN, code: "return eval('1+1');" };
    try {
      renderCadDesign(evil, module_);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CadRenderError);
      expect(err.code).toBe("CAD_GUARD_REJECTED");
    }
  });

  test("wraps kernel failures as CAD_KERNEL_FAILED", () => {
    const broken = { ...DESIGN, code: "return M.banana(P.width);" };
    try {
      renderCadDesign(broken, module_);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CadRenderError);
      expect(err.code).toBe("CAD_KERNEL_FAILED");
    }
  });
});
