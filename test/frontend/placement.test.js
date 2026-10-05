import { describe, expect, test } from "bun:test";
import {
  isValidBounds,
  boundsUnion,
  groundDelta,
  resetOffset,
  moveSnapStep,
  ROTATE_SNAP,
} from "../../frontend/src/js/engine/placement.js";

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
  min: { x: minX, y: minY, z: minZ },
  max: { x: maxX, y: maxY, z: maxZ },
});
// What Babylon's getHierarchyBoundingVectors returns for a node with no meshes.
const EMPTY = box(
  Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE,
  -Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE
);

describe("placement math", () => {
  test("isValidBounds rejects null, empty and non-finite bounds", () => {
    expect(isValidBounds(null)).toBe(false);
    expect(isValidBounds(EMPTY)).toBe(false);
    expect(isValidBounds(box(0, NaN, 0, 1, 1, 1))).toBe(false);
    expect(isValidBounds(box(0, 0, 0, 1, 1, 1))).toBe(true);
  });

  test("boundsUnion merges valid boxes and skips invalid ones", () => {
    const u = boundsUnion([box(0, 2, 0, 1, 3, 1), null, EMPTY, box(-1, 5, 2, 0, 6, 4)]);
    expect(u).toEqual(box(-1, 2, 0, 1, 6, 4));
    expect(boundsUnion([null, EMPTY])).toBeNull();
  });

  test("groundDelta lifts or lowers min.y onto the floor", () => {
    expect(groundDelta(box(0, 5, 0, 1, 6, 1))).toBe(-5);
    expect(groundDelta(box(0, -2, 0, 1, 1, 1))).toBe(2);
    expect(groundDelta(box(0, 1e-9, 0, 1, 1, 1))).toBe(0);
    expect(groundDelta(null)).toBe(0);
    expect(groundDelta(EMPTY)).toBe(0);
  });

  test("a multi-selection grounds as one rigid group (stacking kept)", () => {
    // base on the floor at y 1..2, part stacked on it at y 2..3
    const group = boundsUnion([box(0, 1, 0, 1, 2, 1), box(0, 2, 0, 1, 3, 1)]);
    expect(groundDelta(group)).toBe(-1); // both move by the SAME delta
  });

  test("resetOffset centres X/Z on the origin and grounds", () => {
    expect(resetOffset(box(2, 3, -4, 4, 5, -2))).toEqual({ x: -3, y: -3, z: 3 });
    expect(resetOffset(null)).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("move snap tracks the visible grid cell; rotate snap is 15°", () => {
    expect(moveSnapStep(1)).toBe(2);
    expect(moveSnapStep(2.5)).toBe(5);
    expect(moveSnapStep(0)).toBe(2);
    expect(moveSnapStep(NaN)).toBe(2);
    expect(ROTATE_SNAP).toBeCloseTo(Math.PI / 12);
  });
});
