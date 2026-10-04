import { describe, expect, test } from "bun:test";
import { analyzePrintability } from "../../frontend/src/js/utils/printability.js";

// Unit cube: 8 corners, 12 triangles (2 per face).
const CUBE = {
  positions: [
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ],
  indices: [
    0, 2, 1,  0, 3, 2, // bottom
    4, 5, 6,  4, 6, 7, // top
    0, 1, 5,  0, 5, 4, // front
    2, 3, 7,  2, 7, 6, // back
    1, 2, 6,  1, 6, 5, // right
    0, 4, 7,  0, 7, 3, // left
  ],
};

// Single quad: 4 corners, 2 triangles — 4 boundary edges.
const PLANE = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  indices: [0, 1, 2, 0, 2, 3],
};

describe("analyzePrintability", () => {
  test("closed cube is manifold", () => {
    const r = analyzePrintability([CUBE]);
    expect(r.manifold).toBe(true);
    expect(r.triangleCount).toBe(12);
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
  });

  test("single plane has 4 open edges", () => {
    const r = analyzePrintability([PLANE]);
    expect(r.manifold).toBe(false);
    expect(r.openEdges).toBe(4);
  });

  test("duplicated vertices are welded (positions, not indices)", () => {
    // Same quad as PLANE but each triangle carries its own corners.
    const dup = {
      positions: [
        0, 0, 0, 1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0, 0, 1, 0,
      ],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const r = analyzePrintability([dup]);
    expect(r.triangleCount).toBe(2);
    expect(r.openEdges).toBe(4); // diagonal is welded and shared by 2
  });

  test("an edge shared by 3 triangles is non-manifold", () => {
    // Two extra faces on edge 0-1 (one per side) push its sharer count to 3.
    const threeShare = {
      positions: [...PLANE.positions, 0, 0, 1],
      indices: [...PLANE.indices, 0, 1, 4, 1, 0, 4],
    };
    const r = analyzePrintability([threeShare]);
    expect(r.manifold).toBe(false);
    expect(r.nonManifoldEdges).toBe(1);
  });

  test("degenerate triangles are skipped", () => {
    const deg = { positions: [0, 0, 0, 1, 0, 0], indices: [0, 0, 1] };
    const r = analyzePrintability([deg]);
    expect(r.triangleCount).toBe(0);
    expect(r.manifold).toBe(false); // empty is not print-ready
  });

  test("empty input", () => {
    const r = analyzePrintability([]);
    expect(r).toEqual({
      manifold: false,
      triangleCount: 0,
      openEdges: 0,
      nonManifoldEdges: 0,
    });
  });
});
