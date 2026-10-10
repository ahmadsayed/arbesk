/**
 * Kernel assembly output against the real Manifold module.
 * @remarks Imports the kernel SOURCE by relative path, so a stale built dist
 *   (or one resolved from another checkout) cannot make these pass.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { createCadKernel, MAX_PARTS } from "../../packages/cad-gen/src/core/kernel.ts";

let kernel;
beforeAll(async () => {
  const Module = (await import("manifold-3d")).default;
  const module_ = await Module({
    locateFile: (f) => path.join(process.cwd(), "node_modules", "manifold-3d", f),
  });
  module_.setup();
  kernel = createCadKernel(module_, { segments: 64 });
});

const design = (code) => ({ code, parameters: { s: { value: 10, unit: "mm" } }, summary: "" });

describe("array returns", () => {
  it("keeps touching parts separate instead of fusing them", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([P.s, 0, 0])];"));
    expect(run.parts.length).toBe(2);
    expect(run.stats.parts.count).toBe(2);
    expect(run.stats.parts.array).toBe(true);
    expect(run.stats.parts.bodyCounts).toEqual([1, 1]);
    expect(run.stats.bodies.count).toBe(2);
    expect(run.stats.volumeMm3).toBeCloseTo(2000, 3);
    expect(run.stats.parts.boxes[1].min[0]).toBeCloseTo(5, 3);
    expect(run.stats.bboxMm.min[0]).toBeCloseTo(-5, 3);
    expect(run.stats.bboxMm.max[0]).toBeCloseTo(15, 3);
    // The combined mesh is the parts laid side by side, not a union.
    expect(run.mesh.indices.length).toBe(run.parts[0].indices.length + run.parts[1].indices.length);
  });

  it("tags each body with the part it belongs to", () => {
    const run = kernel.run(design(
      "return [box(P.s, P.s, P.s), box(2, 2, 2).translate([30, 0, 0]).add(box(2, 2, 2).translate([40, 0, 0]))];",
    ));
    expect(run.stats.parts.bodyCounts).toEqual([1, 2]);
    expect(run.stats.bodies.boxes.map((b) => b.part)).toEqual([1, 2, 2]);
  });

  it("drops a part that is only a zero-volume flake", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(5, 5, 5).subtract(box(6, 6, 6))];"));
    expect(run.stats.parts.count).toBe(1);
    expect(run.parts.length).toBe(1);
    expect(run.stats.degenerateBodiesDropped).toBe(1);
  });

  it("reports an empty array as an empty result for the nonempty gate", () => {
    const run = kernel.run(design("P.s; return [];"));
    expect(run.stats.triangles).toBe(0);
    expect(run.stats.parts.count).toBe(0);
    expect(run.stats.bboxMm).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it("names the part that is not a Manifold", () => {
    expect(() => kernel.run(design("return [box(P.s, P.s, P.s), 42];")))
      .toThrow("part 2: did not return a Manifold");
  });

  it("refuses more than MAX_PARTS parts", () => {
    const code = "P.s; const out = []; for (let i = 0; i < " + (MAX_PARTS + 1) + "; i++) out.push(box(1, 1, 1).translate([i * 2, 0, 0])); return out;";
    expect(() => kernel.run(design(code))).toThrow("at most " + MAX_PARTS);
  });
});

describe("single-solid returns", () => {
  it("are one part, with the same mesh as before", () => {
    const run = kernel.run(design("return box(P.s, P.s, P.s);"));
    expect(run.parts.length).toBe(1);
    expect(run.parts[0]).toBe(run.mesh);
    expect(run.stats.parts).toEqual({
      count: 1, array: false, boxes: [run.stats.bboxMm], bodyCounts: [1],
    });
  });
});
