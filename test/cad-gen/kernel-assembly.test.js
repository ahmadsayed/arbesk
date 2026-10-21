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

describe("overlaps", () => {
  it("records parts that overlap, with the shared volume", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([5, 0, 0])];"));
    expect(run.stats.parts.overlapCount).toBe(1);
    expect(run.stats.parts.overlaps[0].a).toBe(1);
    expect(run.stats.parts.overlaps[0].b).toBe(2);
    expect(run.stats.parts.overlaps[0].volumeMm3).toBeCloseTo(500, 3);
  });

  it("does not count parts that only touch", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([P.s, 0, 0])];"));
    expect(run.stats.parts.overlaps).toBeUndefined();
    expect(run.stats.parts.overlapCount).toBeUndefined();
  });
});

describe("sealed voids", () => {
  // CADPrompt 00851553: a hollow cut centred in its block never reaches a face.
  // Manifold decomposes the cavity's skin as a NEGATIVE-volume component.
  const SEALED = "P.s; return box(30, 20, 20).subtract(box(20, 10, 10));";

  it("are not counted as bodies", () => {
    const run = kernel.run(design(SEALED));
    expect(run.stats.bodies.count).toBe(1);
  });

  it("are reported with their bounds", () => {
    const run = kernel.run(design(SEALED));
    expect(run.stats.voids).toEqual({
      count: 1, boxes: [{ min: [-10, -5, -5], max: [10, 5, 5] }],
    });
  });

  it("are not reported for a cut that opens through a face", () => {
    const run = kernel.run(design("P.s; return box(30, 20, 20).subtract(box(20, 10, 10).translate([0, 0, 6]));"));
    expect(run.stats.bodies.count).toBe(1);
    expect(run.stats.voids).toBeUndefined();
  });

  it("are reported for a part of an array return", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s).translate([40, 0, 0]), " + SEALED.slice("P.s; return ".length, -1) + "];"));
    expect(run.stats.bodies.count).toBe(2);
    expect(run.stats.voids.count).toBe(1);
    expect(run.stats.voids.boxes[0].part).toBe(2);
  });
});

describe("color()", () => {
  const coloured = (code) => ({
    code,
    parameters: { s: { value: 10, unit: "mm" }, c: { type: "color", value: "#112233" } },
    summary: "",
  });

  it("color() tags a returned part", () => {
    const run = kernel.run(coloured("return [color(box(P.s, P.s, P.s), P.c), box(1, 1, 1).translate([20, 0, 0])];"));
    expect(run.parts[0].color).toBe("#112233");
    expect(run.parts[1].color).toBeUndefined();
  });

  it("tags a single returned solid and lowercases the hex", () => {
    const run = kernel.run(coloured("P.s; return color(box(1, 1, 1), '#AABBCC');"));
    expect(run.parts[0].color).toBe("#aabbcc");
  });

  it("keeps the colour paired with its part when a flake part is dropped", () => {
    const run = kernel.run(coloured(
      "return [box(5, 5, 5).subtract(box(6, 6, 6)), color(box(P.s, P.s, P.s), P.c)];",
    ));
    expect(run.parts.length).toBe(1);
    expect(run.parts[0].color).toBe("#112233");
  });

  it("a boolean after color() drops the tag", () => {
    const run = kernel.run(coloured("return color(box(P.s, P.s, P.s), P.c).subtract(box(1, 1, 20));"));
    expect(run.parts[0].color).toBeUndefined();
  });

  it("bad hex throws", () => {
    expect(() => kernel.run(coloured("P.s; return color(box(1, 1, 1), 'blue');")))
      .toThrow(/color needs a #rrggbb hex/);
  });

  it("colour parameters reach the script as strings", () => {
    expect(() => kernel.run(coloured(
      "if (typeof P.c !== 'string') throw new Error('not a string'); return box(P.s, 1, 1);",
    ))).not.toThrow();
  });

  it("untagged design parts unchanged", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(1, 1, 1).translate([20, 0, 0])];"));
    expect(run.parts.every((p) => !("color" in p))).toBe(true);
    const single = kernel.run(design("return box(P.s, P.s, P.s);"));
    expect(Object.keys(single.parts[0])).toEqual(["positions", "indices"]);
  });
});
