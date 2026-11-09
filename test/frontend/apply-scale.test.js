// applyScale must compose post_processor.scale with a node root's imported
// scaling: in a left-handed scene the glTF loader's __root__ carries
// scaling (1, 1, -1), and overwriting it mirrors the model (#138). It must
// also scale the root's centring offset, or a scaled model drifts off its
// anchor.
import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: async () => null,
}));

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  multiply(o) {
    return new Vector3(this.x * o.x, this.y * o.y, this.z * o.z);
  }
}

let applyScale;
beforeAll(async () => {
  globalThis.BABYLON = { Vector3 };
  ({ applyScale } = await import("../../frontend/src/js/engine/time-travel.js"));
});

/**
 * A glTF __root__ as attachMetadata leaves it in a left-handed scene:
 * centerImportedAsset has moved it so the geometry's centre sits on the anchor.
 */
function gltfRoot() {
  return {
    name: "__root__",
    scaling: new Vector3(1, 1, -1),
    position: new Vector3(1, -0.5, -1),
    metadata: { nodeId: "n1", isNodeRoot: true },
  };
}
const xyz = (v) => [v.x, v.y, v.z];

describe("applyScale (#138)", () => {
  test("unit scale keeps the root's handedness flip", () => {
    const root = gltfRoot();
    applyScale([root], { x: 1, y: 1, z: 1 });
    expect(xyz(root.scaling)).toEqual([1, 1, -1]);
  });

  test("non-unit scale composes with the imported scaling", () => {
    const root = gltfRoot();
    applyScale([root], { x: 2, y: 3, z: 4 });
    expect(xyz(root.scaling)).toEqual([2, 3, -4]);
  });

  test("re-applying does not compound", () => {
    const root = gltfRoot();
    applyScale([root], { x: 2, y: 2, z: 2 });
    applyScale([root], { x: 2, y: 2, z: 2 });
    applyScale([root], { x: 0.5, y: 0.5, z: 0.5 });
    expect(xyz(root.scaling)).toEqual([0.5, 0.5, -0.5]);
  });

  test("a null scale records nothing, so a later scale still sees the import", () => {
    const root = gltfRoot();
    applyScale([root], null);
    applyScale([root], { x: 2, y: 2, z: 2 });
    expect(xyz(root.scaling)).toEqual([2, 2, -2]);
  });

  test("missing or zero components keep the imported scaling", () => {
    const root = gltfRoot();
    applyScale([root], { x: 0, z: 3 });
    expect(xyz(root.scaling)).toEqual([1, 1, -3]);
  });

  test("non-root meshes and a null scale are left alone", () => {
    const child = {
      scaling: new Vector3(0.001, 0.001, 0.001),
      metadata: { nodeId: "n1", isNodeRoot: false },
    };
    const root = gltfRoot();
    applyScale([root, child], { x: 2, y: 2, z: 2 });
    expect(xyz(child.scaling)).toEqual([0.001, 0.001, 0.001]);
    const other = gltfRoot();
    applyScale([other], null);
    expect(xyz(other.scaling)).toEqual([1, 1, -1]);
  });

  test("the centring offset scales with the model, keeping it centred", () => {
    const root = gltfRoot();
    applyScale([root], { x: 2, y: 3, z: 4 });
    expect(xyz(root.position)).toEqual([2, -1.5, -4]);
  });

  test("unit scale leaves the centring offset alone", () => {
    const root = gltfRoot();
    applyScale([root], { x: 1, y: 1, z: 1 });
    expect(xyz(root.position)).toEqual([1, -0.5, -1]);
  });

  test("re-applying does not compound the centring offset", () => {
    const root = gltfRoot();
    applyScale([root], { x: 2, y: 2, z: 2 });
    applyScale([root], { x: 3, y: 3, z: 3 });
    expect(xyz(root.position)).toEqual([3, -1.5, -3]);
  });

  test("each root gets its own Vector3", () => {
    const a = gltfRoot();
    const b = gltfRoot();
    applyScale([a, b], { x: 2, y: 2, z: 2 });
    expect(a.scaling).not.toBe(b.scaling);
  });
});
