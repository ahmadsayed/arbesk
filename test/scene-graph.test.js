/**
 * Arbesk Scene Graph - Phase 1 Unit Tests
 *
 * Tests pure logic functions from scene-graph.js.
 * Functions are tested inline (matching token-resolver.test.js pattern)
 * to avoid ESM import issues with the frontend directory.
 */

import { jest } from "@jest/globals";

jest.setTimeout(15000);

// ─── Inline copies of functions from scene-graph.js ─────────────────────────

function extractCid(src) {
  if (src && typeof src === "object" && src.cid) {
    return src.cid;
  }
  return src;
}

function detectAssetFormat(src) {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}

function getManifestNodes(manifest) {
  return manifest?.scene?.nodes || [];
}

function getRenderableMeshes(meshes) {
  return meshes.filter(
    (mesh) =>
      mesh &&
      !mesh.isDisposed() &&
      typeof mesh.getTotalVertices === "function" &&
      mesh.getTotalVertices() > 0,
  );
}

// ─── Mock helpers ──────────────────────────────────────────────────────────

function V3(x, y, z) {
  return {
    x,
    y,
    z,
    add: (v) => V3(x + v.x, y + v.y, z + v.z),
    subtract: (v) => V3(x - v.x, y - v.y, z - v.z),
    scale: (s) => V3(x * s, y * s, z * s),
    subtractInPlace(v) {
      this.x -= v.x;
      this.y -= v.y;
      this.z -= v.z;
    },
    clone() {
      return V3(this.x, this.y, this.z);
    },
  };
}

function makeMesh(name, vertices = 10) {
  const mesh = {
    name,
    parent: null,
    metadata: {},
    material: null,
    position: V3(0, 0, 0),
    _disposed: false,
    isDisposed() {
      return this._disposed;
    },
    dispose() {
      this._disposed = true;
    },
    getTotalVertices() {
      return vertices;
    },
    computeWorldMatrix() {},
    refreshBoundingInfo() {},
    getBoundingInfo() {
      return {
        boundingBox: {
          minimumWorld: V3(-0.5, -0.5, -0.5),
          maximumWorld: V3(0.5, 0.5, 0.5),
        },
      };
    },
    getWorldMatrix() {
      return {
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        clone() {
          return this;
        },
        invert() {
          return this;
        },
      };
    },
    getChildMeshes() {
      return [];
    },
  };
  return mesh;
}

function makeNode() {
  return {
    parent: null,
    metadata: {},
    scaling: V3(1, 1, 1),
    position: V3(0, 0, 0),
    _disposed: false,
    isDisposed() {
      return this._disposed;
    },
    dispose() {
      this._disposed = true;
    },
    computeWorldMatrix() {},
    getWorldMatrix() {
      return makeMesh("dummy").getWorldMatrix();
    },
  };
}

function makeMatrix(values) {
  const m = [...values];
  return {
    m,
    decompose(scale, rotation, translation) {
      translation.x = m[12];
      translation.y = m[13];
      translation.z = m[14];
      if (scale) {
        scale.x = 1;
        scale.y = 1;
        scale.z = 1;
      }
      if (rotation) {
        rotation.x = 0;
        rotation.y = 0;
        rotation.z = 0;
        rotation.w = 1;
      }
    },
    clone() {
      return makeMatrix([...this.m]);
    },
    invert() {
      return makeMatrix([...this.m]);
    },
  };
}

// Inline copies of BABYLON-dependent functions (adapted for mock classes)

function getWorldBounds(meshes) {
  let min = V3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  let max = V3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    if (typeof mesh.refreshBoundingInfo === "function") {
      mesh.refreshBoundingInfo();
    }
    const boundingInfo = mesh.getBoundingInfo?.();
    const boundingBox = boundingInfo?.boundingBox;
    if (!boundingBox) continue;

    min = V3(
      Math.min(min.x, boundingBox.minimumWorld.x),
      Math.min(min.y, boundingBox.minimumWorld.y),
      Math.min(min.z, boundingBox.minimumWorld.z),
    );
    max = V3(
      Math.max(max.x, boundingBox.maximumWorld.x),
      Math.max(max.y, boundingBox.maximumWorld.y),
      Math.max(max.z, boundingBox.maximumWorld.z),
    );
  }

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;

  const center = V3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );
  const size = V3(max.x - min.x, max.y - min.y, max.z - min.z);
  return { min, max, center, size };
}

function applyTransformMatrix(meshOrNode, matrixArray) {
  if (!matrixArray || matrixArray.length !== 16) return;

  const matrix = makeMatrix(matrixArray);
  const scale = V3(1, 1, 1);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const translation = V3(0, 0, 0);
  matrix.decompose(scale, rotation, translation);

  meshOrNode.scaling = scale;
  meshOrNode.rotationQuaternion = rotation;
  meshOrNode.position = translation;
}

const DEFAULT_WOOD_COLOR = "#C19A6B";

function applyDefaultMaterial(meshes, defaultMaterial) {
  const woodColor = DEFAULT_WOOD_COLOR;
  for (const mesh of meshes) {
    if (mesh.material) {
      if (mesh.material.diffuseColor !== undefined) {
        mesh.material.diffuseColor = woodColor;
      } else if (mesh.material.albedoColor !== undefined) {
        mesh.material.albedoColor = woodColor;
      }
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor !== undefined) mat.diffuseColor = woodColor;
          else if (mat.albedoColor !== undefined) mat.albedoColor = woodColor;
        }
      }
    } else {
      mesh.material = defaultMaterial || { diffuseColor: woodColor };
    }
  }
}

function centerImportedAsset(meshes, importedNodes, parentNode, _nodeId) {
  const renderableMeshes = getRenderableMeshes(meshes);
  if (renderableMeshes.length === 0) return;

  const bounds = getWorldBounds(renderableMeshes);
  if (!bounds) return;

  const rootNodes = importedNodes.filter((node) => node?.parent === parentNode);
  if (rootNodes.length === 0) return;

  parentNode.computeWorldMatrix(true);
  const inverseParentWorld = parentNode.getWorldMatrix().clone().invert();

  // Transform world center to local space
  const wm = inverseParentWorld.m;
  const cx = bounds.center.x,
    cy = bounds.center.y,
    cz = bounds.center.z;
  const localCenter = V3(
    wm[0] * cx + wm[4] * cy + wm[8] * cz + wm[12],
    wm[1] * cx + wm[5] * cy + wm[9] * cz + wm[13],
    wm[2] * cx + wm[6] * cy + wm[10] * cz + wm[14],
  );

  if (!Number.isFinite(localCenter.x)) return;

  for (const rootNode of rootNodes) {
    rootNode.position.subtractInPlace(localCenter);
    rootNode.computeWorldMatrix(true);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("extractCid", () => {
  it("returns cid from a source object", () => {
    expect(extractCid({ cid: "QmTest123", path: "asset.glb" })).toBe(
      "QmTest123",
    );
  });

  it("returns plain string as-is", () => {
    expect(extractCid("QmPlainCid")).toBe("QmPlainCid");
  });

  it("returns null/undefined as-is", () => {
    expect(extractCid(null)).toBe(null);
    expect(extractCid(undefined)).toBe(undefined);
  });

  it("returns object without cid key as-is", () => {
    const src = { path: "asset.glb", format: "glb" };
    expect(extractCid(src)).toBe(src);
  });

  it("returns non-object values as-is", () => {
    expect(extractCid(42)).toBe(42);
    expect(extractCid(false)).toBe(false);
  });
});

describe("detectAssetFormat", () => {
  it("returns format from source object (lowercased)", () => {
    expect(detectAssetFormat({ format: "GLB" })).toBe("glb");
    expect(detectAssetFormat({ format: "gltf" })).toBe("gltf");
    expect(detectAssetFormat({ format: "FBX" })).toBe("fbx");
  });

  it('defaults to "gltf" for source objects without format', () => {
    expect(detectAssetFormat({ cid: "QmTest" })).toBe("gltf");
  });

  it('defaults to "gltf" for non-object inputs', () => {
    expect(detectAssetFormat(null)).toBe("gltf");
    expect(detectAssetFormat(undefined)).toBe("gltf");
    expect(detectAssetFormat("plain string")).toBe("gltf");
  });
});

describe("getManifestNodes", () => {
  it("returns nodes array from valid manifest", () => {
    const manifest = {
      scene: { nodes: [{ node_id: "n1" }, { node_id: "n2" }] },
    };
    expect(getManifestNodes(manifest)).toHaveLength(2);
    expect(getManifestNodes(manifest)[0].node_id).toBe("n1");
  });

  it("returns empty array for manifest without scene", () => {
    expect(getManifestNodes({})).toEqual([]);
  });

  it("returns empty array for null/undefined", () => {
    expect(getManifestNodes(null)).toEqual([]);
    expect(getManifestNodes(undefined)).toEqual([]);
  });
});

describe("getRenderableMeshes", () => {
  it("filters out disposed meshes", () => {
    const good = makeMesh("good", 10);
    const disposed = makeMesh("bad", 10);
    disposed._disposed = true;

    const result = getRenderableMeshes([good, disposed]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("good");
  });

  it("filters out meshes with zero vertices", () => {
    const good = makeMesh("good", 10);
    const empty = makeMesh("empty", 0);

    const result = getRenderableMeshes([good, empty]);
    expect(result).toHaveLength(1);
  });

  it("filters out null/undefined entries", () => {
    const good = makeMesh("good", 5);
    const result = getRenderableMeshes([null, undefined, good]);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(getRenderableMeshes([])).toEqual([]);
  });
});

describe("getWorldBounds", () => {
  it("computes bounds from a single mesh", () => {
    const mesh = makeMesh("test", 10);
    const bounds = getWorldBounds([mesh]);

    expect(bounds).not.toBeNull();
    expect(bounds.center.x).toBe(0);
    expect(bounds.center.y).toBe(0);
    expect(bounds.center.z).toBe(0);
    expect(bounds.size.x).toBe(1);
  });

  it("returns null for empty input", () => {
    expect(getWorldBounds([])).toBeNull();
  });

  it("returns null when meshes lack bounding info", () => {
    const mesh = makeMesh("noBounds", 10);
    mesh.getBoundingInfo = () => null;
    expect(getWorldBounds([mesh])).toBeNull();
  });
});

describe("applyTransformMatrix", () => {
  it("extracts translation from column-major matrix", () => {
    const node = makeNode();
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 5, -2, 1];

    applyTransformMatrix(node, matrix);

    expect(node.position.x).toBe(10);
    expect(node.position.y).toBe(5);
    expect(node.position.z).toBe(-2);
  });

  it("sets identity scale/rotation for identity matrix", () => {
    const node = makeNode();
    applyTransformMatrix(
      node,
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );

    expect(node.scaling.x).toBe(1);
    expect(node.position.x).toBe(0);
  });

  it("does nothing on null/undefined matrix", () => {
    const node = makeNode();
    node.position.x = 99;
    applyTransformMatrix(node, null);
    expect(node.position.x).toBe(99);
    applyTransformMatrix(node, undefined);
    expect(node.position.x).toBe(99);
  });

  it("does nothing on wrong-length matrix", () => {
    const node = makeNode();
    node.position.x = 99;
    applyTransformMatrix(node, [1, 0, 0]);
    expect(node.position.x).toBe(99);
  });
});

describe("applyDefaultMaterial", () => {
  it("applies wood color to meshes with diffuseColor", () => {
    const mesh = makeMesh("test", 10);
    mesh.material = { diffuseColor: "#FFFFFF", getSubMeshMaterials: () => [] };

    applyDefaultMaterial([mesh]);

    expect(mesh.material.diffuseColor).toBe(DEFAULT_WOOD_COLOR);
  });

  it("applies wood color to meshes with albedoColor", () => {
    const mesh = makeMesh("test", 10);
    mesh.material = { albedoColor: "#FFFFFF", getSubMeshMaterials: () => [] };

    applyDefaultMaterial([mesh]);

    expect(mesh.material.albedoColor).toBe(DEFAULT_WOOD_COLOR);
  });

  it("applies wood color to sub-mesh materials", () => {
    const sub1 = { diffuseColor: "#FFFFFF" };
    const sub2 = { albedoColor: "#FFFFFF" };
    const mesh = makeMesh("multi", 10);
    mesh.material = { getSubMeshMaterials: () => [sub1, sub2] };

    applyDefaultMaterial([mesh]);

    expect(sub1.diffuseColor).toBe(DEFAULT_WOOD_COLOR);
    expect(sub2.albedoColor).toBe(DEFAULT_WOOD_COLOR);
  });

  it("does not throw on meshes without material", () => {
    expect(() => applyDefaultMaterial([makeMesh("noMat", 10)])).not.toThrow();
  });

  it("handles empty mesh array", () => {
    expect(() => applyDefaultMaterial([])).not.toThrow();
  });
});

describe("centerImportedAsset", () => {
  it("shifts root node position by negative bounding center", () => {
    const parent = makeNode();
    const mesh = makeMesh("test", 10);
    mesh.parent = parent;
    // Override bounds: x from 0 to 2 → center at x=1
    mesh.getBoundingInfo = () => ({
      boundingBox: {
        minimumWorld: V3(0, 0, 0),
        maximumWorld: V3(2, 0, 0),
      },
    });

    const rootNode = makeNode();
    rootNode.parent = parent;
    rootNode.position = V3(5, 0, 0);

    centerImportedAsset([mesh], [rootNode], parent, "node_test");

    // 5 - 1 = 4
    expect(rootNode.position.x).toBeCloseTo(4, 5);
  });

  it("does nothing when no renderable meshes", () => {
    const parent = makeNode();
    const emptyMesh = makeMesh("empty", 0);
    expect(() =>
      centerImportedAsset([emptyMesh], [], parent, "node_empty"),
    ).not.toThrow();
  });

  it("does nothing when bounds are null", () => {
    const parent = makeNode();
    const mesh = makeMesh("noBounds", 10);
    mesh.getBoundingInfo = () => null;
    expect(() =>
      centerImportedAsset([mesh], [], parent, "node_nobounds"),
    ).not.toThrow();
  });
});

describe("DEFAULT_WOOD_COLOR", () => {
  it("is a valid hex color", () => {
    expect(DEFAULT_WOOD_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 - BABYLON-dependent integration tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── Shared mock state (simulating scene-graph.js module state) ────────────

let mockScene;
let mockNodeMeshes;
let mockNodeAnchors;
let mockRootSceneAnchor;
let mockDefaultWoodMaterial;
let mockPendingChildRefs;

function resetMockState() {
  mockScene = {
    transformNodes: [],
    meshes: [],
    materials: [],
    stoppedAnimations: [],
    startedAnimations: [],
    stopAllAnimations() {
      this.stoppedAnimations.push("__all__");
    },
    stopAnimation(target) {
      this.stoppedAnimations.push(target);
    },
    beginAnimation(target, from, to, loop) {
      this.startedAnimations.push({ target, from, to, loop });
    },
    getTransformNodeByName() {
      return null;
    },
  };
  mockNodeMeshes = new Map();
  mockNodeAnchors = new Map();
  mockRootSceneAnchor = null;
  mockDefaultWoodMaterial = null;
  mockPendingChildRefs = [];

  globalThis.BABYLON = {
    Vector3: function (x, y, z) {
      return V3(x, y, z);
    },
    Color3: { FromHexString: (hex) => ({ r: 0, g: 0, b: 0, _hex: hex }) },
    Matrix: { FromValues: (...v) => makeMatrix(v) },
    Quaternion: { Identity: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
    MeshBuilder: {
      CreateBox: (name, opts) => {
        const box = makeMesh(name, 10);
        box.scaling = V3(opts?.size || 1, opts?.size || 1, opts?.size || 1);
        box.animations = [];
        return box;
      },
    },
    StandardMaterial: function () {
      return {
        diffuseColor: null,
        albedoColor: null,
        alpha: 1,
        getSubMeshMaterials() {
          return [];
        },
        dispose() {},
      };
    },
    Animation: function (name, targetProp, fps, type, loopMode) {
      const anim = {
        name,
        targetProp,
        fps,
        type,
        loopMode,
        _keys: [],
        setKeys(keys) {
          this._keys = keys;
        },
      };
      return anim;
    },
    TransformNode: function () {
      const n = makeNode();
      return n;
    },
  };
  BABYLON.Animation.ANIMATIONTYPE_VECTOR3 = 1;
  BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE = 2;
  BABYLON.Vector3.Zero = () => V3(0, 0, 0);
}

const PLACEHOLDER_COLOR = "#E8D5B7";
const ERROR_PLACEHOLDER_COLOR = "#CC6666";

function createPlaceholder(nodeId, parentNode, state) {
  const color = state === "error" ? ERROR_PLACEHOLDER_COLOR : PLACEHOLDER_COLOR;
  const box = BABYLON.MeshBuilder.CreateBox("placeholder_" + nodeId, {
    size: 0.5,
  });
  box.parent = parentNode;
  box.metadata = { nodeId, isPlaceholder: true, placeholderState: state };
  const mat = new BABYLON.StandardMaterial("placeholderMat_" + nodeId);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.alpha = state === "loading" ? 0.6 : 0.8;
  box.material = mat;
  if (state === "loading") {
    const pulseAnim = new BABYLON.Animation(
      "pulse_" + nodeId,
      "scaling",
      30,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    pulseAnim.setKeys([
      { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
      { frame: 15, value: new BABYLON.Vector3(1.2, 1.2, 1.2) },
      { frame: 30, value: new BABYLON.Vector3(1, 1, 1) },
    ]);
    box.animations = [pulseAnim];
    mockScene.beginAnimation(box, 0, 30, true);
  }
  box.metadata = { ...box.metadata, _placeholderAnim: state === "loading" };
  return box;
}

function disposePlaceholder(placeholder) {
  if (!placeholder || placeholder.isDisposed()) return;
  if (placeholder.metadata?._placeholderAnim)
    mockScene.stopAnimation(placeholder);
  placeholder.dispose();
}

function attachMetadata(meshes, nodeId, parentNode, transformNodes = []) {
  const meshArray = [];
  for (const tNode of transformNodes) {
    if (tNode.parent === null) tNode.parent = parentNode;
    tNode.metadata = {
      ...(tNode.metadata || {}),
      nodeId,
      isNodeRoot: tNode.parent === parentNode,
    };
  }
  for (const mesh of meshes) {
    if (mesh.parent === null) mesh.parent = parentNode;
    mesh.metadata = {
      ...(mesh.metadata || {}),
      nodeId,
      isNodeRoot: mesh.parent === parentNode,
    };
    meshArray.push(mesh);
  }
  mockNodeMeshes.set(nodeId, meshArray);
  return meshArray;
}

function disposeNode(nodeId) {
  const meshes = mockNodeMeshes.get(nodeId);
  if (meshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) mesh.dispose();
    }
    mockNodeMeshes.delete(nodeId);
  }
  const anchor = mockNodeAnchors.get(nodeId);
  if (anchor) {
    if (!anchor.isDisposed()) anchor.dispose();
    mockNodeAnchors.delete(nodeId);
  }
}

function getNodeAnchor(nodeId) {
  return mockNodeAnchors.get(nodeId) || null;
}
function getNodeMeshes(nodeId) {
  return mockNodeMeshes.get(nodeId) || [];
}

function clearScene() {
  if (!mockScene) return;
  mockScene.stopAllAnimations();
  for (const [, meshes] of mockNodeMeshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) mesh.dispose();
    }
  }
  mockNodeMeshes.clear();
  for (const [, anchor] of mockNodeAnchors) {
    if (anchor && !anchor.isDisposed()) anchor.dispose();
  }
  mockNodeAnchors.clear();
  if (mockRootSceneAnchor && !mockRootSceneAnchor.isDisposed())
    mockRootSceneAnchor.dispose();
  mockRootSceneAnchor = null;
  for (const tn of [...mockScene.transformNodes]) {
    if (tn && !tn.isDisposed()) tn.dispose();
  }
  for (const m of [...mockScene.meshes]) {
    if (m && !m.isDisposed()) m.dispose();
  }
  if (mockDefaultWoodMaterial) {
    mockDefaultWoodMaterial.dispose();
    mockDefaultWoodMaterial = null;
  }
  mockPendingChildRefs.length = 0;
}

function getNodeChildRef(nodeId) {
  if (nodeId && nodeId.startsWith("child_token_")) {
    const anchor = mockNodeAnchors.get(nodeId);
    if (anchor?.metadata?.childRef) {
      return {
        ...anchor.metadata.childRef,
        resolvedCid: anchor.metadata.resolvedCid || null,
      };
    }
  }
  const anchor = mockNodeAnchors.get(nodeId);
  if (anchor) {
    let current = anchor.parent;
    while (current) {
      if (current.metadata?.childRef) {
        return {
          ...current.metadata.childRef,
          resolvedCid: current.metadata.resolvedCid || null,
        };
      }
      current = current.parent;
    }
  }
  return null;
}

// ─── Phase 2 Tests ─────────────────────────────────────────────────────────

describe("createPlaceholder", () => {
  beforeEach(() => resetMockState());

  it("creates error placeholder with correct color and alpha", () => {
    const box = createPlaceholder("n1", makeNode(), "error");
    expect(box.metadata.isPlaceholder).toBe(true);
    expect(box.metadata.placeholderState).toBe("error");
    expect(box.material.diffuseColor._hex).toBe(ERROR_PLACEHOLDER_COLOR);
    expect(box.material.alpha).toBe(0.8);
    expect(box.metadata._placeholderAnim).toBe(false);
  });

  it("creates loading placeholder with pulse animation", () => {
    const box = createPlaceholder("n2", makeNode(), "loading");
    expect(box.metadata.placeholderState).toBe("loading");
    expect(box.material.alpha).toBe(0.6);
    expect(box.metadata._placeholderAnim).toBe(true);
    expect(box.animations).toHaveLength(1);
    expect(box.animations[0]._keys).toHaveLength(3);
    expect(box.animations[0]._keys[0].value.x).toBe(1);
    expect(box.animations[0]._keys[1].value.x).toBe(1.2);
    expect(box.animations[0]._keys[2].value.x).toBe(1);
    expect(mockScene.startedAnimations).toHaveLength(1);
  });

  it("uses 0.5 box size", () => {
    const box = createPlaceholder("n3", makeNode(), "loading");
    expect(box.scaling.x).toBe(0.5);
  });
});

describe("disposePlaceholder", () => {
  beforeEach(() => resetMockState());

  it("stops animation and disposes loading placeholder", () => {
    const box = createPlaceholder("n1", makeNode(), "loading");
    disposePlaceholder(box);
    expect(box.isDisposed()).toBe(true);
    expect(mockScene.stoppedAnimations).toContain(box);
  });

  it("disposes error placeholder without stopping animation", () => {
    const box = createPlaceholder("n2", makeNode(), "error");
    disposePlaceholder(box);
    expect(box.isDisposed()).toBe(true);
    expect(mockScene.stoppedAnimations).toHaveLength(0);
  });

  it("does nothing on null or already-disposed", () => {
    expect(() => disposePlaceholder(null)).not.toThrow();
    const box = createPlaceholder("n3", makeNode(), "loading");
    box.dispose();
    const before = mockScene.stoppedAnimations.length;
    disposePlaceholder(box);
    expect(mockScene.stoppedAnimations).toHaveLength(before);
  });
});

describe("attachMetadata", () => {
  beforeEach(() => resetMockState());

  it("assigns parent and metadata to orphan meshes", () => {
    const parent = makeNode();
    const mesh = makeMesh("test", 10);
    const result = attachMetadata([mesh], "node_m", parent);
    expect(mesh.parent).toBe(parent);
    expect(mesh.metadata.nodeId).toBe("node_m");
    expect(mesh.metadata.isNodeRoot).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("tracks meshes in nodeMeshes map", () => {
    const mesh = makeMesh("test", 10);
    attachMetadata([mesh], "node_mapped", makeNode());
    expect(mockNodeMeshes.has("node_mapped")).toBe(true);
    expect(mockNodeMeshes.get("node_mapped")).toContain(mesh);
  });

  it("handles transform nodes with null parent", () => {
    const parent = makeNode();
    const tNode = makeNode();
    tNode.parent = null;
    attachMetadata([makeMesh("m", 10)], "node_tf", parent, [tNode]);
    expect(tNode.parent).toBe(parent);
    expect(tNode.metadata.nodeId).toBe("node_tf");
  });

  it("preserves existing metadata", () => {
    const mesh = makeMesh("test", 10);
    mesh.metadata = { custom: "keep" };
    attachMetadata([mesh], "node_p", makeNode());
    expect(mesh.metadata.custom).toBe("keep");
    expect(mesh.metadata.nodeId).toBe("node_p");
  });

  it("does not reparent meshes with existing parent", () => {
    const old = makeNode();
    const mesh = makeMesh("test", 10);
    mesh.parent = old;
    attachMetadata([mesh], "node_p2", makeNode());
    expect(mesh.parent).toBe(old);
    expect(mesh.metadata.isNodeRoot).toBe(false);
  });

  it("handles empty mesh array", () => {
    attachMetadata([], "node_e", makeNode());
    expect(mockNodeMeshes.get("node_e")).toEqual([]);
  });
});

describe("disposeNode", () => {
  beforeEach(() => resetMockState());

  it("disposes all meshes and anchor", () => {
    const anchor = makeNode();
    const m1 = makeMesh("m1", 10);
    const m2 = makeMesh("m2", 10);
    mockNodeMeshes.set("n", [m1, m2]);
    mockNodeAnchors.set("n", anchor);
    disposeNode("n");
    expect(m1.isDisposed()).toBe(true);
    expect(m2.isDisposed()).toBe(true);
    expect(anchor.isDisposed()).toBe(true);
    expect(mockNodeMeshes.has("n")).toBe(false);
    expect(mockNodeAnchors.has("n")).toBe(false);
  });

  it("handles node with meshes but no anchor", () => {
    const m = makeMesh("m1", 10);
    mockNodeMeshes.set("n2", [m]);
    disposeNode("n2");
    expect(m.isDisposed()).toBe(true);
  });

  it("does nothing for unknown nodeId", () => {
    expect(() => disposeNode("unknown")).not.toThrow();
  });
});

describe("clearScene", () => {
  beforeEach(() => resetMockState());

  it("disposes all tracked state and orphans", () => {
    const root = makeNode();
    const anchor = makeNode();
    const mesh = makeMesh("m", 10);
    mockRootSceneAnchor = root;
    mockNodeMeshes.set("n", [mesh]);
    mockNodeAnchors.set("n", anchor);
    mockDefaultWoodMaterial = { dispose: jest.fn() };
    mockScene.transformNodes = [makeNode()];
    mockScene.meshes = [makeMesh("orphan", 10)];
    mockPendingChildRefs.push({ node_id: "x" });

    clearScene();

    expect(mesh.isDisposed()).toBe(true);
    expect(anchor.isDisposed()).toBe(true);
    expect(root.isDisposed()).toBe(true);
    expect(mockScene.transformNodes[0].isDisposed()).toBe(true);
    expect(mockScene.meshes[0].isDisposed()).toBe(true);
    expect(mockNodeMeshes.size).toBe(0);
    expect(mockNodeAnchors.size).toBe(0);
    expect(mockRootSceneAnchor).toBe(null);
    expect(mockPendingChildRefs).toHaveLength(0);
  });

  it("stops all animations first", () => {
    mockRootSceneAnchor = makeNode();
    clearScene();
    expect(mockScene.stoppedAnimations).toContain("__all__");
  });

  it("handles null scene gracefully", () => {
    mockScene = null;
    expect(() => clearScene()).not.toThrow();
  });

  it("clears empty scene without errors", () => {
    expect(() => clearScene()).not.toThrow();
  });

  it("disposes default wood material", () => {
    const spy = jest.fn();
    mockDefaultWoodMaterial = { dispose: spy };
    clearScene();
    expect(spy).toHaveBeenCalled();
    expect(mockDefaultWoodMaterial).toBe(null);
  });
});

describe("getNodeChildRef", () => {
  beforeEach(() => resetMockState());

  it("returns child_ref for token child node by anchor metadata", () => {
    const anchor = makeNode();
    anchor.metadata = {
      childRef: { type: "token", tokenId: "42" },
      resolvedCid: "QmCid",
    };
    mockNodeAnchors.set("child_token_314159_abc_42", anchor);
    const r = getNodeChildRef("child_token_314159_abc_42");
    expect(r.tokenId).toBe("42");
    expect(r.resolvedCid).toBe("QmCid");
  });

  it("returns null for regular node", () => {
    mockNodeAnchors.set("regular", makeNode());
    expect(getNodeChildRef("regular")).toBe(null);
  });

  it("walks ancestor chain for child_ref context", () => {
    const child = makeNode();
    const parent = makeNode();
    parent.metadata = { childRef: { tokenId: "7" }, resolvedCid: "QmParent" };
    child.parent = parent;
    mockNodeAnchors.set("nested", child);
    const r = getNodeChildRef("nested");
    expect(r.tokenId).toBe("7");
  });

  it("returns null for unknown/null nodeId", () => {
    expect(getNodeChildRef(null)).toBe(null);
    expect(getNodeChildRef("none")).toBe(null);
  });
});

describe("getNodeAnchor and getNodeMeshes", () => {
  beforeEach(() => resetMockState());

  it("returns stored values", () => {
    const a = makeNode();
    const m = makeMesh("m", 5);
    mockNodeAnchors.set("na", a);
    mockNodeMeshes.set("na", [m]);
    expect(getNodeAnchor("na")).toBe(a);
    expect(getNodeMeshes("na")).toEqual([m]);
  });

  it("returns null/empty for unknown keys", () => {
    expect(getNodeAnchor("x")).toBe(null);
    expect(getNodeMeshes("x")).toEqual([]);
  });
});

describe("Scene Graph - buildChildRefResolutionPlan", () => {
  function buildChildRefResolutionPlan(childRef, activeCollectionAssets) {
    if (!childRef) return { kind: "invalid" };
    if (childRef.assetID) {
      if (childRef.collection === "self") {
        return {
          kind: "same-collection",
          assetID: childRef.assetID,
          assetsMap: activeCollectionAssets,
        };
      }
      if (childRef.collection && childRef.collection.tokenId) {
        return {
          kind: "cross-collection-asset",
          collectionRef: childRef.collection,
          assetID: childRef.assetID,
        };
      }
    }
    return { kind: "invalid" };
  }

  it("plans a same-collection lookup for collection: 'self'", () => {
    const assetsMap = { "chair-01": "bafyChair" };
    const plan = buildChildRefResolutionPlan(
      { collection: "self", assetID: "chair-01" },
      assetsMap,
    );
    expect(plan).toEqual({
      kind: "same-collection",
      assetID: "chair-01",
      assetsMap,
    });
  });

  it("plans a cross-collection-asset lookup when collection is a token ref", () => {
    const collectionRef = {
      chainId: 6343,
      contractAddress: "0xabc",
      tokenId: "42",
    };
    const plan = buildChildRefResolutionPlan(
      { collection: collectionRef, assetID: "chair-01" },
      null,
    );
    expect(plan).toEqual({
      kind: "cross-collection-asset",
      collectionRef,
      assetID: "chair-01",
    });
  });

  it("returns invalid for a malformed child_ref", () => {
    expect(buildChildRefResolutionPlan({}, null)).toEqual({ kind: "invalid" });
    expect(buildChildRefResolutionPlan(null, null)).toEqual({
      kind: "invalid",
    });
  });
});

describe("Scene Graph - buildForkOrLiveRefNode", () => {
  function buildForkOrLiveRefNode(choice, ref, assetID, resolvedAssetCid) {
    const nodeId = `linked_${ref.collectionRef.tokenId}_${assetID}`;
    const baseNode = {
      node_id: nodeId,
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    if (choice === "fork") {
      return {
        ...baseNode,
        source: { cid: resolvedAssetCid },
      };
    }
    if (choice === "live-ref") {
      return {
        ...baseNode,
        child_ref: { collection: ref.collectionRef, assetID },
      };
    }
    throw new Error(`Unknown fork/live-ref choice: ${choice}`);
  }

  const ref = {
    collectionRef: { chainId: 6343, contractAddress: "0xabc", tokenId: "42" },
  };

  it("fork builds a plain source node with the resolved CID, frozen", () => {
    const node = buildForkOrLiveRefNode(
      "fork",
      ref,
      "chair-01",
      "bafyChairCid",
    );
    expect(node.source).toEqual({ cid: "bafyChairCid" });
    expect(node.child_ref).toBeUndefined();
  });

  it("live-ref builds a child_ref node pointing at the original collection", () => {
    const node = buildForkOrLiveRefNode(
      "live-ref",
      ref,
      "chair-01",
      "bafyChairCid",
    );
    expect(node.child_ref).toEqual({
      collection: ref.collectionRef,
      assetID: "chair-01",
    });
    expect(node.source).toBeUndefined();
  });

  it("throws on an unknown choice", () => {
    expect(() =>
      buildForkOrLiveRefNode("bogus", ref, "chair-01", "cid"),
    ).toThrow();
  });
});
