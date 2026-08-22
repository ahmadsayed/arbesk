/**
 * updateCameraRangeForScene (jsdom) with a mocked Babylon runtime.
 *
 * Regression: after the "adapt camera to model size" work was reverted, huge
 * models (the big cave scan) could not be viewed whole — the fixed
 * upperRadiusLimit of 500 kept parts of the model out of frame no matter how
 * far the user zoomed out. The restored behavior scales the zoom range and
 * the viewport chrome (grid/axes) from the model's largest dimension.
 *
 * @jest-environment jsdom
 */

import { expect, test, beforeAll, beforeEach } from "@jest/globals";

// ─── Babylon mock ───

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

let state, updateCameraRangeForScene, updateGridCoverage, clampOrthoCameraDistance;

beforeAll(async () => {
  globalThis.BABYLON = {
    Vector3: V3,
    Camera: { ORTHOGRAPHIC_CAMERA: 1, PERSPECTIVE_CAMERA: 0 },
  };
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  ({
    updateCameraRangeForScene,
    updateGridCoverage,
    clampOrthoCameraDistance,
  } = await import("../../frontend/src/js/engine/scene-camera.js"));
});

beforeEach(() => {
  state._nonChromeMeshCache = null;
  state._sceneContentBounds = null;
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

test("ortho guard: camera stranded inside the model is pushed outside", () => {
  // The "dissolving goat" state: ortho camera at radius 0.109 with the model
  // spanning ±0.5 — Babylon's wheel input shrinks radius invisibly in ortho.
  state.camera.mode = 1; // ORTHOGRAPHIC_CAMERA
  state.camera.minZ = 0.01;
  state.camera.maxZ = 200;
  state.camera.orthoTop = 0.45;
  state.camera.orthoBottom = -0.45;
  state.camera.radius = 0.109;

  clampOrthoCameraDistance();

  // perspective-equivalent radius: span/(2·tan(fov/2)) = 0.9/0.8456 ≈ 1.0644,
  // plus the 0.1 margin — still well outside the ±0.5 model
  expect(state.camera.radius).toBeCloseTo(1.1644, 3);
  expect(state.camera.maxZ).toBe(200); // already sufficient, untouched
});

test("ortho guard: far plane grows when ortho zoom-out outruns it", () => {
  state.camera.mode = 1;
  state.camera.minZ = 0.01;
  state.camera.maxZ = 10;
  state.camera.orthoTop = 100;
  state.camera.orthoBottom = -100;
  state.camera.radius = 5;

  clampOrthoCameraDistance();

  // perspective-equivalent: 200/0.84559 ≈ 236.622, plus margin
  expect(state.camera.radius).toBeCloseTo(236.622, 2);
  // No cached scene bounds → conservative fallback: camera→target distance
  // plus the same extent behind the target, plus the near margin.
  expect(state.camera.maxZ).toBeCloseTo(236.622 + 100 + 0.1, 2);
});

test("ortho guard: zoomed-in ortho of a deep model slices into it (breakthrough)", () => {
  // Deep model with the cave's proportions: 1200 along X, 200 in Y/Z.
  state.scene.meshes = [fakeMesh([-600, -100, -100], [600, 100, 100])];
  updateCameraRangeForScene(); // caches content bounds; maxZ=120000, minZ=1.2

  // Ortho RIGHT view (looking down -X), zoomed IN: frustum span 100 is
  // tighter than the model's 200 height, so the model no longer fits and the
  // radius tracks the frustum — the near plane slices into the model as the
  // user zooms, matching the perspective preview's "break through" feel.
  state.camera.mode = 1;
  state.camera.orthoTop = 50;
  state.camera.orthoBottom = -50;
  state.camera.target = new V3(0, 0, 0);
  state.camera.position = new V3(652, 0, 0);
  state.camera.radius = 30;

  clampOrthoCameraDistance();

  // Zoomed branch: the radius ramps down from the surface distance in
  // proportion to the zoom — fwd·(span/2)/upExtent = 600·0.5 = 300 dominates
  // the perspective-equivalent 118.26 — plus margin minZ*10 = 12.
  expect(state.camera.radius).toBeCloseTo(312, 3);
  expect(state.camera.maxZ).toBe(120000); // already ample, untouched
});

test("ortho guard: fit view of a deep model keeps the camera outside", () => {
  state.scene.meshes = [fakeMesh([-600, -100, -100], [600, 100, 100])];
  updateCameraRangeForScene();

  // Same view, but the frustum shows the WHOLE model (span 1304 ≥ height
  // 200): the camera must stay clear of the 600-deep extent or the snap view
  // would slice the model it is meant to frame.
  state.camera.mode = 1;
  state.camera.orthoTop = 652;
  state.camera.orthoBottom = -652;
  state.camera.target = new V3(0, 0, 0);
  state.camera.position = new V3(652, 0, 0);
  state.camera.radius = 30; // decayed by Babylon's wheel input

  clampOrthoCameraDistance();

  // Fit branch: max(perspective-equivalent 1304/0.8456 ≈ 1542.1, depth 600)
  // plus margin 12 — well outside the model.
  expect(state.camera.radius).toBeCloseTo(1554.1, 1);
  expect(state.camera.maxZ).toBe(120000);
});

test("ortho guard: perspective camera is never touched", () => {
  state.camera.mode = 0; // PERSPECTIVE_CAMERA
  state.camera.radius = 0.109;
  state.camera.orthoTop = 0.45;
  state.camera.orthoBottom = -0.45;

  clampOrthoCameraDistance();

  expect(state.camera.radius).toBe(0.109);
});

test("ortho guard: radius is pinned to the frustum even when larger", () => {
  // Radius is invisible in ortho, so any value a writer leaves behind (a
  // decayed pose restore, snapView's initial estimate) is replaced by the
  // frustum-derived one — hidden radius state can no longer accumulate.
  state.camera.mode = 1;
  state.camera.minZ = 0.01;
  state.camera.maxZ = 200;
  state.camera.orthoTop = 0.45;
  state.camera.orthoBottom = -0.45;
  state.camera.radius = 3;

  clampOrthoCameraDistance();

  // pinned to the perspective-equivalent of the span, not left at 3
  expect(state.camera.radius).toBeCloseTo(1.1644, 3);
});
