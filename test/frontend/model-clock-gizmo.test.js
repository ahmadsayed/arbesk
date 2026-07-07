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
});
