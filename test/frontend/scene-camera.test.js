// @test-env dom
/**
 * updateCameraRangeForScene (jsdom) with a mocked Babylon runtime.
 *
 * Regression: after the "adapt camera to model size" work was reverted, huge
 * models (the big cave scan) could not be viewed whole — the fixed
 * upperRadiusLimit of 500 kept parts of the model out of frame no matter how
 * far the user zoomed out. The restored behavior scales the zoom range and
 * the viewport chrome (grid/axes) from the model's largest dimension.
 *
 */


// ─── Babylon mock ───

import { beforeAll, beforeEach, expect, test } from "bun:test";
class V3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  add(v) {
    return new V3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  subtract(v) {
    return new V3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  scale(s) {
    return new V3(this.x * s, this.y * s, this.z * s);
  }
  static Minimize(a, b) {
    return new V3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  }
  static Maximize(a, b) {
    return new V3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }
}

function fakeMesh(min, max, { chrome = false } = {}) {
  return {
    metadata: chrome ? { isViewportChrome: true } : null,
    isDisposed: () => false,
    getTotalVertices: () => 3,
    computeWorldMatrix: () => {},
    getBoundingInfo: () => ({
      boundingBox: {
        minimumWorld: new V3(...min),
        maximumWorld: new V3(...max),
      },
    }),
  };
}

function fakeChrome() {
  return { scaling: new V3(1, 1, 1) };
}

let state, updateCameraRangeForScene, updateGridCoverage, frameNode;
let animations = [];

beforeAll(async () => {
  globalThis.BABYLON = {
    Vector3: V3,
    Camera: { ORTHOGRAPHIC_CAMERA: 1, PERSPECTIVE_CAMERA: 0 },
    Animation: {
      ANIMATIONLOOPMODE_CONSTANT: 2,
      CreateAndStartAnimation: (_name, _target, prop, _fps, _frames, _from, to) =>
        animations.push({ prop, to }),
    },
  };
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  ({
    updateCameraRangeForScene,
    updateGridCoverage,
    frameNode,
  } = await import("../../frontend/src/js/engine/scene-camera.js"));
});

beforeEach(() => {
  animations = [];
  state.nodeAnchors = new Map();
  state._nonChromeMeshCache = null;
  const chrome = { groundGrid: fakeChrome(), axisX: fakeChrome(), axisZ: fakeChrome() };
  state.scene = {
    meshes: [],
    getMeshByName: (name) => chrome[name] || null,
    _chrome: chrome,
  };
  state.camera = {
    minZ: 1,
    maxZ: 10000,
    lowerRadiusLimit: 2,
    upperRadiusLimit: 500,
    radius: 15,
    fov: 0.8,
    beta: 1.2,
  };
});

test("huge model: zoom-out limit and chrome scale up", () => {
  // Cave-like scene, largest dimension 2000 world units.
  state.scene.meshes = [fakeMesh([-1000, -500, -1000], [1000, 500, 1000])];

  updateCameraRangeForScene();

  expect(state.camera.upperRadiusLimit).toBe(20000); // maxDim * 10
  expect(state.camera.lowerRadiusLimit).toBe(0.1); // zoom-in stays close
  // Far plane must outrun the zoom-out limit yet stay content-tight, and the
  // near plane scales with it at a pinned 1:1e5 ratio — a fixed small minZ
  // against a huge maxZ collapses 24-bit depth precision until surfaces
  // z-fight and slice through each other (the cave regression).
  expect(state.camera.maxZ).toBe(200000); // max(maxDim*100, maxLimit*4)
  expect(state.camera.minZ).toBe(2); // maxZ / 1e5
  expect(state.scene._chrome.groundGrid.scaling.x).toBe(150); // 2000*3/40
  expect(state.scene._chrome.axisX.scaling.x).toBe(150); // 2000*1.5/20
});

test("normal model: tight zoom range, default far plane and chrome", () => {
  state.scene.meshes = [fakeMesh([-1, -1, -1], [1, 1, 1])];

  updateCameraRangeForScene();

  // Small models get the 50 floor, not 500 — at 500 a ~1-unit model shrinks
  // to a pixel at max zoom-out and looks clipped.
  expect(state.camera.upperRadiusLimit).toBe(50);
  expect(state.camera.maxZ).toBe(200); // content-tight: max(2*100, 50*4)
  expect(state.camera.minZ).toBe(0.002); // maxZ / 1e5 — small models keep close zoom
  expect(state.scene._chrome.groundGrid.scaling.x).toBe(1);
  expect(state.scene._chrome.axisZ.scaling.x).toBe(1);
});

test("tiny model (20mm CAD part in metres): zoom-in limit drops so it can be framed", () => {
  state.scene.meshes = [fakeMesh([-0.01, 0, -0.005], [0.01, 0.02, 0.005])];

  updateCameraRangeForScene();

  expect(state.camera.lowerRadiusLimit).toBeCloseTo(0.01, 10); // maxDim * 0.5
  expect(state.camera.minZ).toBe(0.002); // still well inside the zoom-in limit
});

test("frameNode frames every mesh under the node's anchor (live-ref children included)", () => {
  // A live-ref's meshes are keyed by the child's inner node id, so framing
  // goes through the anchor hierarchy rather than state.nodeMeshes.
  const anchor = {
    getChildMeshes: () => [fakeMesh([4, 0, 4], [6, 2, 6])],
  };
  state.nodeAnchors.set("linked_1", anchor);

  frameNode("linked_1");

  const target = animations.find((a) => a.prop === "target").to;
  expect([target.x, target.y, target.z]).toEqual([5, 1, 5]);
  expect(animations.find((a) => a.prop === "radius")).toBeTruthy();
});

test("frameNode is a no-op for an unknown node", () => {
  frameNode("missing");
  expect(animations).toEqual([]);
});

test("viewport chrome meshes are excluded from the size computation", () => {
  state.scene.meshes = [
    fakeMesh([-9999, -9999, -9999], [9999, 9999, 9999], { chrome: true }),
    fakeMesh([-2, -2, -2], [2, 2, 2]),
  ];

  updateCameraRangeForScene();

  expect(state.camera.upperRadiusLimit).toBe(50);
});

test("empty scene: no-op", () => {
  updateCameraRangeForScene();
  expect(state.camera.upperRadiusLimit).toBe(500);
  expect(state.camera.lowerRadiusLimit).toBe(2);
});

test("grid coverage: grows in power-of-two steps past the model scale", () => {
  state.scene.meshes = [fakeMesh([-1000, -500, -1000], [1000, 500, 1000])];
  updateCameraRangeForScene(); // base grid scale 150
  const grid = state.scene._chrome.groundGrid;

  state.camera.radius = 100; // view fits inside the base grid
  updateGridCoverage();
  expect(grid.scaling.x).toBe(150);

  state.camera.radius = 4000; // needs 200 → next pow2 step
  updateGridCoverage();
  expect(grid.scaling.x).toBe(256);

  state.camera.radius = 9000; // needs 450 → 512
  updateGridCoverage();
  expect(grid.scaling.x).toBe(512);

  state.camera.radius = 100; // zooming back in returns to the base scale
  updateGridCoverage();
  expect(grid.scaling.x).toBe(150);
});

test("grid coverage: small model keeps the default grid at any sane zoom", () => {
  state.scene.meshes = [fakeMesh([-1, -1, -1], [1, 1, 1])];
  updateCameraRangeForScene(); // base scale 1
  const grid = state.scene._chrome.groundGrid;

  state.camera.radius = 15;
  updateGridCoverage();
  expect(grid.scaling.x).toBe(1);
});

test("grid coverage: shallow view angles extend the grid further", () => {
  state.scene.meshes = [fakeMesh([-1, -1, -1], [1, 1, 1])];
  updateCameraRangeForScene(); // base scale 1
  const grid = state.scene._chrome.groundGrid;

  // Grazing angle (beta ~20°): the visible ground stretches ~3x farther.
  state.camera.beta = 0.35;
  state.camera.radius = 100;
  updateGridCoverage();
  expect(grid.scaling.x).toBe(16); // 100/sin(0.35)/20 = 14.6 → pow2

  // Back to a steep angle: coverage shrinks again.
  state.camera.beta = 1.2;
  updateGridCoverage();
  expect(grid.scaling.x).toBe(8); // 100/0.932/20 = 5.4 → pow2
});
