import { beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "manifold-3d";
import { createScorer, exactIoU } from "../../scripts/lib/bench-iou.mjs";
import { alignAndScore } from "../../scripts/lib/mesh-metrics.mjs";
import { writeBinaryStl } from "../../scripts/lib/stl.mjs";
import { box, moved } from "./helpers/bench-meshes.js";

const WASM_DIR = path.resolve(import.meta.dirname, "..", "..", "node_modules", "manifold-3d");
/** @type {any} */
let module;
const IDENTITY = { generatedSteps: [], truthSteps: [] };

beforeAll(async () => {
  module = await Module(/** @type {any} */ ({ locateFile: (/** @type {string} */ f) => path.join(WASM_DIR, f) }));
  module.setup();
});

describe("exactIoU", () => {
  it("is 1 for identical solids", () => {
    expect(exactIoU(module, box([1, 1, 1]), box([1, 1, 1]), IDENTITY).iou).toBeCloseTo(1, 9);
  });

  it("is 1/3 for unit cubes offset by half a side", () => {
    const out = exactIoU(module, box([1, 1, 1]), box([1, 1, 1], [0.5, 0, 0]), IDENTITY);
    expect(out.iou).toBeCloseTo(1 / 3, 9);
    expect(out.reason).toBeNull();
  });

  it("returns null with a reason for a non-manifold mesh", () => {
    const sheet = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    const out = exactIoU(module, sheet, box([1, 1, 1]), IDENTITY);
    expect(out.iou).toBeNull();
    expect(out.reason).toContain("generated not manifold");
  });

  it("measures in the frame alignAndScore found", () => {
    const truth = box([2, 1, 0.5]);
    const generated = moved(truth, 15, 100, [40, -25, 7]);
    const frame = alignAndScore(generated, truth);
    expect(exactIoU(module, generated, truth, frame).iou).toBeGreaterThan(0.95);
  });
});

describe("createScorer", () => {
  it("scores a mesh against a ground-truth STL on disk", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bench-iou-")), "gt.stl");
    writeBinaryStl(file, box([2, 1, 0.5]));
    const metrics = createScorer(module)(moved(box([2, 1, 0.5]), 0, 100, [0, 0, 0]), file);
    expect(metrics.chamfer).toBeLessThan(1e-6);
    expect(metrics.iogt).toBeCloseTo(1, 6);
    expect(metrics.iou).toBeCloseTo(1, 6);
    expect(metrics.iouReason).toBeNull();
  });
});
