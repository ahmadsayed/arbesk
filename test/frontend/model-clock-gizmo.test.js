/**
 * @jest-environment jsdom
 */
import { expect, test, describe } from "@jest/globals";
import { _ringRadiusFromBounds } from "../../frontend/src/js/ui/model-clock-gizmo.js";

describe("model-clock-gizmo math", () => {
  test("_ringRadiusFromBounds clamps and scales", () => {
    expect(_ringRadiusFromBounds({ x: -1, y: 0, z: -1 }, { x: 1, y: 2, z: 1 })).toBeCloseTo(1.4, 5);
    expect(_ringRadiusFromBounds({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0.1 })).toBe(0.5);
    expect(_ringRadiusFromBounds({ x: -10, y: 0, z: -10 }, { x: 10, y: 20, z: 10 })).toBe(8.0);
  });

  test("_angleForIndex places versions clockwise from newest to oldest", async () => {
    const { _angleForIndex } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    // 4 entries: newest at 180°, then 90°, 0°, oldest at -90° (12 o'clock)
    expect(_angleForIndex(0, 4)).toBe(180);
    expect(_angleForIndex(1, 4)).toBe(90);
    expect(_angleForIndex(3, 4)).toBe(-90);
  });

  test("_indexForAngle snaps to nearest version", async () => {
    const { _indexForAngle } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    // Matches _angleForIndex: newest at 180° (n=4), oldest at -90° (12 o'clock).
    expect(_indexForAngle(180, 4)).toBe(0); // newest
    expect(_indexForAngle(170, 4)).toBe(0); // closer to newest
    expect(_indexForAngle(80, 4)).toBe(1); // closer to index 1
    expect(_indexForAngle(-90, 4)).toBe(3); // oldest
  });
});
