/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import {
  readNodeTransformMatrix,
  stageNodeTransform,
  matricesEqual,
} from "../../frontend/src/js/engine/transforms.js";

const FAKE_MATRIX = { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] };

beforeEach(() => {
  global.BABYLON = {
    Quaternion: class {
      static Identity() {
        return new global.BABYLON.Quaternion();
      }
    },
    Matrix: { Compose: () => FAKE_MATRIX },
  };
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
});

afterEach(() => {
  delete global.BABYLON;
});

describe("readNodeTransformMatrix", () => {
  test("returns the 16-element column-major matrix for a live anchor", () => {
    state.nodeAnchors.set("n1", {
      scaling: {},
      rotationQuaternion: null,
      position: {},
      isDisposed: () => false,
    });
    expect(readNodeTransformMatrix("n1")).toEqual(FAKE_MATRIX.m);
  });

  test("returns null for missing or disposed anchors", () => {
    expect(readNodeTransformMatrix("nope")).toBe(null);
    state.nodeAnchors.set("n2", { isDisposed: () => true });
    expect(readNodeTransformMatrix("n2")).toBe(null);
  });
});

describe("matricesEqual", () => {
  test("true for identical matrices, false beyond epsilon", () => {
    const a = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    expect(matricesEqual(a, [...a])).toBe(true);
    const b = [...a];
    b[12] += 1e-5;
    expect(matricesEqual(a, b)).toBe(false);
  });
});

describe("stageNodeTransform", () => {
  test("stages the read matrix into pendingTransformEdits", () => {
    state.nodeAnchors.set("n1", {
      scaling: {},
      rotationQuaternion: null,
      position: {},
      isDisposed: () => false,
    });
    expect(stageNodeTransform("n1")).toBe(true);
    expect(state.pendingTransformEdits.get("n1")).toEqual(FAKE_MATRIX.m);
  });

  test("returns false for a missing anchor", () => {
    expect(stageNodeTransform("nope")).toBe(false);
  });
});
