// @test-env dom
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import {
  readNodeTransformMatrix,
  stageNodeTransform,
  matricesEqual,
  extractCid,
  getManifestNodes,
  getRenderableMeshes,
  applyTransformMatrix,
  applyDefaultMaterial,
  centerImportedAsset,
} from "../../frontend/src/js/engine/transforms.js";
import {
  createPlaceholder,
  disposePlaceholder,
} from "../../frontend/src/js/engine/placeholders.js";

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

// Ported from the removed test/scene-graph.test.js inline copies: exercise the
// real engine helpers instead of clones.
describe("engine helpers (real modules)", () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    add(o) {
      return new Vector3(this.x + o.x, this.y + o.y, this.z + o.z);
    }
    subtract(o) {
      return new Vector3(this.x - o.x, this.y - o.y, this.z - o.z);
    }
    subtractInPlace(o) {
      this.x -= o.x;
      this.y -= o.y;
      this.z -= o.z;
      return this;
    }
    scale(s) {
      return new Vector3(this.x * s, this.y * s, this.z * s);
    }
    clone() {
      return new Vector3(this.x, this.y, this.z);
    }
    static Minimize(a, b) {
      return new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
    }
    static Maximize(a, b) {
      return new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
    }
    static TransformCoordinates(v) {
      return new Vector3(v.x, v.y, v.z);
    }
  }

  const vec = (x, y, z) => new Vector3(x, y, z);

  beforeEach(() => {
    class Animation {
      constructor(name, targetProp, fps, type, loopMode) {
        this.name = name;
        this.targetProp = targetProp;
        this.fps = fps;
        this.type = type;
        this.loopMode = loopMode;
        this.keys = [];
      }
      setKeys(keys) {
        this.keys = keys;
      }
    }
    Animation.ANIMATIONTYPE_VECTOR3 = 1;
    Animation.ANIMATIONLOOPMODE_CYCLE = 2;

    global.BABYLON = {
      Vector3,
      Quaternion: class {},
      Matrix: {
        Compose: () => ({ m: IDENTITY }),
        FromValues: (...m) => ({
          decompose(scale, rotation, translation) {
            scale.x = 1;
            scale.y = 1;
            scale.z = 1;
            rotation.x = 0;
            rotation.y = 0;
            rotation.z = 0;
            rotation.w = 1;
            translation.x = m[12];
            translation.y = m[13];
            translation.z = m[14];
          },
        }),
      },
      Color3: { FromHexString: (hex) => ({ hex }) },
      StandardMaterial: class {
        constructor(name, scene) {
          this.name = name;
          this.scene = scene;
          this.dispose = jest.fn();
        }
      },
      MeshBuilder: {
        CreateBox: (name, opts, scene) => ({
          name,
          opts,
          scene,
          parent: null,
          metadata: null,
          material: null,
          animations: [],
          isDisposed: () => false,
          dispose: jest.fn(),
        }),
      },
      Animation,
    };
    state.scene = {
      beginAnimation: jest.fn(),
      stopAnimation: jest.fn(),
    };
    state.defaultWoodMaterial = null;
  });

  test("extractCid reads a source object's cid and passes other values through", () => {
    expect(extractCid({ cid: "bafyTest", path: "asset.glb" })).toBe("bafyTest");
    expect(extractCid("bafyPlain")).toBe("bafyPlain");
    expect(extractCid(null)).toBe(null);
    expect(extractCid(undefined)).toBe(undefined);
  });

  test("getManifestNodes returns scene nodes or an empty array", () => {
    const nodes = [{ node_id: "n1" }, { node_id: "n2" }];
    expect(getManifestNodes({ scene: { nodes } })).toBe(nodes);
    expect(getManifestNodes({})).toEqual([]);
    expect(getManifestNodes(null)).toEqual([]);
  });

  test("getRenderableMeshes keeps only live, non-empty meshes", () => {
    const good = { isDisposed: () => false, getTotalVertices: () => 10 };
    const disposed = { isDisposed: () => true, getTotalVertices: () => 10 };
    const empty = { isDisposed: () => false, getTotalVertices: () => 0 };
    expect(getRenderableMeshes([good, disposed, empty, null])).toEqual([good]);
  });

  test("applyTransformMatrix decomposes a column-major matrix onto the node", () => {
    const node = {};
    applyTransformMatrix(node, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    expect(node.position).toEqual({ x: 5, y: 6, z: 7 });
    expect(node.scaling).toEqual({ x: 1, y: 1, z: 1 });
    expect(node.rotationQuaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  test("applyTransformMatrix ignores a matrix that is not 16 elements", () => {
    const node = {};
    applyTransformMatrix(node, [1, 0, 0]);
    expect(node.position).toBeUndefined();
  });

  test("applyDefaultMaterial tints existing materials and shares the fallback", () => {
    const mesh = { material: { diffuseColor: { r: 1, g: 1, b: 1 } } };
    const bare = { material: null };
    applyDefaultMaterial([mesh, bare]);
    expect(mesh.material.diffuseColor).toEqual({ hex: "#C19A6B" });
    expect(bare.material).toBe(state.defaultWoodMaterial);
    expect(state.defaultWoodMaterial.diffuseColor).toEqual({ hex: "#C19A6B" });
  });

  test("createPlaceholder builds an animated loading box and disposePlaceholder cleans it up", () => {
    const parent = {};
    const box = createPlaceholder("n1", parent, "loading");
    expect(box.parent).toBe(parent);
    expect(box.metadata).toEqual({
      nodeId: "n1",
      isPlaceholder: true,
      placeholderState: "loading",
      _placeholderAnim: true,
    });
    expect(box.material.alpha).toBe(0.6);
    expect(state.scene.beginAnimation).toHaveBeenCalledWith(box, 0, 30, true);

    disposePlaceholder(box);
    expect(state.scene.stopAnimation).toHaveBeenCalledWith(box);
    expect(box.dispose).toHaveBeenCalledTimes(1);
    expect(box.material.dispose).toHaveBeenCalledTimes(1);
  });

  test("createPlaceholder builds an opaque, non-animated error box", () => {
    const box = createPlaceholder("n2", {}, "error");
    expect(box.material.alpha).toBe(0.8);
    expect(box.metadata._placeholderAnim).toBe(false);
    expect(state.scene.beginAnimation).not.toHaveBeenCalled();
  });

  test("getNodeChildRef reads an anchor's own ref or walks up to a parent ref", async () => {
    const { getNodeChildRef } = await import(
      "../../frontend/src/js/engine/scene-graph.js"
    );
    const tokenRef = {
      chainId: 1,
      contractAddress: "0xabc",
      tokenId: "42",
    };
    const parent = {
      metadata: { childRef: tokenRef, resolvedCid: "bafyChild" },
      parent: null,
    };
    state.nodeAnchors.set("child", { metadata: {}, parent });
    expect(getNodeChildRef("child")).toEqual({
      ...tokenRef,
      resolvedCid: "bafyChild",
    });

    state.nodeAnchors.set("own", {
      metadata: { childRef: { assetID: "asset-a" } },
      parent: null,
    });
    expect(getNodeChildRef("own")).toEqual({
      assetID: "asset-a",
      resolvedCid: null,
    });
    expect(getNodeChildRef("missing")).toBe(null);
  });

  test("centerImportedAsset shifts root nodes by the negative bounds centre", () => {
    const parent = {
      computeWorldMatrix: jest.fn(),
      getWorldMatrix: () => ({
        clone: () => ({ invert: () => ({ m: IDENTITY }) }),
      }),
    };
    const mesh = {
      isDisposed: () => false,
      getTotalVertices: () => 8,
      computeWorldMatrix: jest.fn(),
      refreshBoundingInfo: jest.fn(),
      getBoundingInfo: () => ({
        boundingBox: { minimumWorld: vec(0, 0, 0), maximumWorld: vec(2, 2, 2) },
      }),
    };
    const root = {
      parent,
      position: vec(5, 5, 5),
      metadata: null,
      computeWorldMatrix: jest.fn(),
    };

    centerImportedAsset([mesh], [root], parent, "n1");

    expect([root.position.x, root.position.y, root.position.z]).toEqual([4, 4, 4]);
    expect(root.metadata.centeringOffset).toEqual({ x: 1, y: 1, z: 1 });
  });
});
