import { beforeEach, describe, expect, test } from "bun:test";
import {
  anchorsBounds,
  translateWorld,
  groundAnchors,
  resetAnchor,
} from "../../frontend/src/js/engine/placement-actions.js";

// A parentless anchor whose world bounds are its local box offset by position.
function mkAnchor(box, pos = { x: 0, y: 0, z: 0 }) {
  const a = {
    parent: null,
    position: {
      ...pos,
      addInPlace(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
        return this;
      },
    },
    rotationQuaternion: { w: 0.7 },
    scaling: { x: 2, y: 2, z: 2 },
    computeWorldMatrix() {},
    getHierarchyBoundingVectors() {
      const p = a.position;
      return {
        min: { x: box[0] + p.x, y: box[1] + p.y, z: box[2] + p.z },
        max: { x: box[3] + p.x, y: box[4] + p.y, z: box[5] + p.z },
      };
    },
  };
  return a;
}

beforeEach(() => {
  global.BABYLON = {
    Vector3: class {
      constructor(x, y, z) {
        Object.assign(this, { x, y, z });
      }
      static TransformNormal(v) {
        return v;
      }
    },
    Matrix: { Invert: (m) => m },
    Quaternion: { Identity: () => ({ w: 1 }) },
  };
});

describe("placement-actions", () => {
  test("anchorsBounds unions anchors and skips ones without bounds", () => {
    const b = anchorsBounds([mkAnchor([0, 1, 0, 1, 2, 1]), {}, mkAnchor([2, 3, 2, 3, 4, 3])]);
    expect(b).toEqual({ min: { x: 0, y: 1, z: 0 }, max: { x: 3, y: 4, z: 3 } });
    expect(anchorsBounds([{}])).toBeNull();
  });

  test("groundAnchors moves a stacked group by one shared delta", () => {
    const base = mkAnchor([0, 0, 0, 1, 1, 1], { x: 0, y: 3, z: 0 });
    const top = mkAnchor([0, 0, 0, 1, 1, 1], { x: 0, y: 4, z: 0 });
    expect(groundAnchors([base, top])).toBe(-3);
    expect(base.position.y).toBe(0);
    expect(top.position.y).toBe(1); // still stacked on the base
    expect(groundAnchors([base, top])).toBe(0); // already grounded
  });

  test("resetAnchor: identity rotation, centred on X/Z, grounded, scale kept", () => {
    const a = mkAnchor([0, 0, 0, 2, 1, 2], { x: 5, y: 7, z: -3 });
    resetAnchor(a);
    expect(a.rotationQuaternion.w).toBe(1);
    expect(a.position).toMatchObject({ x: -1, y: 0, z: -1 }); // box centre at 0,0
    expect(a.scaling).toEqual({ x: 2, y: 2, z: 2 });
  });

  test("translateWorld converts through the parent's inverse world matrix", () => {
    let inverted = null;
    BABYLON.Matrix.Invert = (m) => {
      inverted = m;
      return m;
    };
    const a = mkAnchor([0, 0, 0, 1, 1, 1]);
    a.parent = { getWorldMatrix: () => "PARENT_WORLD" };
    translateWorld(a, { x: 0, y: 2, z: 0 });
    expect(inverted).toBe("PARENT_WORLD");
    expect(a.position.y).toBe(2);
  });
});
