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
      static FromEulerVector() {
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

  test("falls back to Euler rotation when rotationQuaternion is null", () => {
    // Babylon's gizmos write Euler `rotation` on nodes whose rotationQuaternion
    // is null — staging must convert it, not drop it (child-asset anchors).
    const eulerRotation = { x: 0.1, y: 0.2, z: 0.3 };
    const sentinel = { convertedFromEuler: true };
    global.BABYLON.Quaternion.FromEulerVector = (v) => {
      expect(v).toBe(eulerRotation);
      return sentinel;
    };
    let composedRotation = null;
    global.BABYLON.Matrix.Compose = (s, r) => {
      composedRotation = r;
      return FAKE_MATRIX;
    };
    state.nodeAnchors.set("n3", {
      scaling: {},
      rotation: eulerRotation,
      rotationQuaternion: null,
      position: {},
      isDisposed: () => false,
    });
    readNodeTransformMatrix("n3");
    expect(composedRotation).toBe(sentinel);
  });
});

describe("matricesEqual", () => {
  test("true for identical matrices, false beyond epsilon", () => {
    const a = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    expect(matricesEqual(a, [...a])).toBe(true);
    const b = [...a];
    b[12] += 1e-5;
    expect(matricesEqual(a, b)).toBe(false);
    const c = [...a];
    c[12] += 1e-7; // within epsilon
    expect(matricesEqual(a, c)).toBe(true);
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

describe("getWorldBounds", () => {
  // Minimal Vector3 stub for getWorldBounds' math.
  const installVector3 = () => {
    global.BABYLON.Vector3 = class {
      constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
      add(o) { return new global.BABYLON.Vector3(this.x + o.x, this.y + o.y, this.z + o.z); }
      subtract(o) { return new global.BABYLON.Vector3(this.x - o.x, this.y - o.y, this.z - o.z); }
      scale(s) { return new global.BABYLON.Vector3(this.x * s, this.y * s, this.z * s); }
      static Minimize(a, b) { return new global.BABYLON.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)); }
      static Maximize(a, b) { return new global.BABYLON.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)); }
    };
  };
  const vec = (x, y, z) => new global.BABYLON.Vector3(x, y, z);
  const meshWith = (extra) => ({
    computeWorldMatrix: () => {},
    refreshBoundingInfo: (...args) => { extra.calls.push(args); },
    getBoundingInfo: () => ({ boundingBox: { minimumWorld: vec(0, 0, 0), maximumWorld: vec(1, 1, 1) } }),
    ...extra,
  });

  test("applies the skeleton when refreshing bounds for skinned meshes", async () => {
    installVector3();
    const { getWorldBounds } = await import("../../frontend/src/js/engine/transforms.js");
    // Tripo rigged GLBs parent the skinned mesh under a half-height Armature
    // offset — raw geometry bounds land half a body above the rendered pose.
    const calls = [];
    const skinned = meshWith({ calls, skeleton: { bones: [] } });
    getWorldBounds([skinned]);
    expect(calls[0]).toEqual([true, false]);
  });

  test("does not apply the skeleton for plain meshes", async () => {
    installVector3();
    const { getWorldBounds } = await import("../../frontend/src/js/engine/transforms.js");
    const calls = [];
    const plain = meshWith({ calls });
    getWorldBounds([plain]);
    expect(calls[0]).toEqual([false, false]);
  });
});
