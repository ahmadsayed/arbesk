/**
 * @jest-environment jsdom
 */
import {
  jest,
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import { state } from "../../frontend/src/js/engine/state.js";

const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 1, timestamp: null },
];

let _subscriber = null;
const storeMock = {
  getState: jest.fn(() => ({
    entries: ENTRIES,
    activeCid: "c3",
    publishedCid: null,
    isLoading: false,
  })),
  subscribe: jest.fn((fn) => {
    _subscriber = fn;
    return () => {};
  }),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => ENTRIES),
  _deps: {},
};

jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);

function createBabylonMock() {
  const disposed = [];
  const createdMeshes = [];

  class MockVector3 {
    constructor(x, y, z) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
    static Minimize(a, b) {
      return new MockVector3(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.min(a.z, b.z)
      );
    }
    static Maximize(a, b) {
      return new MockVector3(
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
        Math.max(a.z, b.z)
      );
    }
    static Project(world, _worldMatrix, _transformMatrix, viewport) {
      return new MockVector3(viewport.width / 2, viewport.height / 2, 0.5);
    }
    clone() {
      return new MockVector3(this.x, this.y, this.z);
    }
    copyFrom(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    subtract(v) {
      return new MockVector3(this.x - v.x, this.y - v.y, this.z - v.z);
    }
    applyRotationQuaternion(_q) {
      return this;
    }
  }

  class MockTransformNode {
    constructor(name, scene) {
      this.name = name;
      this.scene = scene;
      this.position = new MockVector3();
      this.rotation = new MockVector3();
      this.scaling = new MockVector3(1, 1, 1);
      this.rotationQuaternion = null;
      this.parent = null;
      this._children = [];
      this._disposed = false;
    }
    dispose(doNotRecurse = false, disposeMaterialAndTextures = false) {
      this._disposed = true;
      disposed.push(this);
      if (!doNotRecurse) {
        for (const child of this._children) {
          child.dispose(doNotRecurse, disposeMaterialAndTextures);
        }
        this._children = [];
      }
    }
    setParent(p) {
      this.parent = p;
      if (p && p._children && !p._children.includes(this)) {
        p._children.push(this);
      }
    }
    getAbsolutePosition() {
      return this.position.clone();
    }
    isDisposed() {
      return this._disposed;
    }
  }

  class MockMesh extends MockTransformNode {
    constructor(name, scene) {
      super(name, scene);
      this.material = null;
      this.renderingGroupId = 0;
      this.isVisible = true;
      this.behaviors = [];
      createdMeshes.push(this);
    }
    addBehavior(b) {
      this.behaviors.push(b);
    }
    dispose(doNotRecurse = false, disposeMaterialAndTextures = false) {
      if (disposeMaterialAndTextures && this.material) {
        this.material.dispose();
      }
      super.dispose(doNotRecurse, disposeMaterialAndTextures);
    }
  }

  class MockQuaternion {
    static Identity() {
      return new MockQuaternion();
    }
    static Inverse(q) {
      return q;
    }
    clone() {
      return this;
    }
    copyFrom() {
      return this;
    }
  }

  return {
    Vector3: MockVector3,
    Matrix: { Identity: () => ({}) },
    TransformNode: MockTransformNode,
    MeshBuilder: {
      CreateTorus: (name, opts, scene) => new MockMesh(name, scene),
      CreateSphere: (name, opts, scene) => new MockMesh(name, scene),
      CreateCylinder: (name, opts, scene) => new MockMesh(name, scene),
      CreateBox: (name, opts, scene) => new MockMesh(name, scene),
    },
    Quaternion: MockQuaternion,
    PointerEventTypes: { POINTERDOWN: 1, POINTERUP: 2, POINTERMOVE: 4 },
    UtilityLayerRenderer: null,
    StandardMaterial: class {
      constructor(name, scene) {
        this.name = name;
        this.scene = scene;
        this.diffuseColor = null;
        this.emissiveColor = null;
        this.specularColor = null;
        this.disableLighting = false;
        this.alpha = 1;
        this._disposed = false;
      }
      dispose() {
        this._disposed = true;
      }
    },
    Color3: class {
      constructor(r, g, b) {
        this.r = r;
        this.g = g;
        this.b = b;
      }
    },
    Color4: class {
      constructor(r, g, b, a) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
      }
    },
    createdMeshes,
    disposed,
  };
}

describe("model-clock-gizmo math", () => {
  test("_ringRadiusFromBounds clamps and scales", async () => {
    const { _ringRadiusFromBounds } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
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

  test("_rayPlaneIntersect hits the plane and rejects parallel/behind rays", async () => {
    const { _rayPlaneIntersect } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    const hit = _rayPlaneIntersect(
      { x: 1, y: 2, z: -10 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }
    );
    expect(hit).toEqual({ x: 1, y: 2, z: 0 });

    // Parallel ray never hits.
    expect(
      _rayPlaneIntersect(
        { x: 0, y: 0, z: -10 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeNull();

    // Plane behind the ray origin.
    expect(
      _rayPlaneIntersect(
        { x: 0, y: 0, z: 10 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }
      )
    ).toBeNull();
  });

  test("_lerpAngle interpolates along the shortest arc across the wrap", async () => {
    const { _lerpAngle } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    expect(_lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 5);
    // From 170° to -170° the short way is +20°, not -340°.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    expect(_lerpAngle(from, to, 0.5)).toBeCloseTo((180 * Math.PI) / 180, 5);
    expect(_lerpAngle(1.2, 1.2, 0.5)).toBeCloseTo(1.2, 5);
  });
});

describe("model-clock-gizmo lifecycle", () => {
  let viewport, scene, camera, babylon;
  let destroyGizmo = null;

  beforeEach(() => {
    document.getElementById("viewport")?.remove();
    document.getElementById("modelClockBadge")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    babylon = createBabylonMock();
    global.BABYLON = babylon;

    state.highlightedNodeId = null;
    state.isGizmoDragging = false;
    state.nodeMeshes = new Map();
    state.nodeAnchors = new Map();
    state.transformMode = "time";

    storeMock.versionsForNode.mockReturnValue(ENTRIES);
    storeMock.loadVersion.mockClear();

    const canvasMock = { clientWidth: 800, clientHeight: 600, style: {} };
    scene = {
      onBeforeRenderObservable: { add: jest.fn(), remove: jest.fn() },
      onPointerObservable: { add: jest.fn(() => ({})), remove: jest.fn() },
      pointerX: 0,
      pointerY: 0,
      createPickingRay: jest.fn(() => ({
        origin: new babylon.Vector3(0, 0, -10),
        direction: new babylon.Vector3(0, 0, 1),
      })),
      getTransformMatrix: () => ({}),
      getEngine: () => ({
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => canvasMock,
      }),
    };
    babylon.UtilityLayerRenderer = { DefaultUtilityLayer: { utilityLayerScene: scene } };
    camera = {
      viewport: { toGlobal: () => ({ width: 800, height: 600 }) },
      detachControl: jest.fn(),
      attachControl: jest.fn(),
    };
  });

  afterEach(() => {
    destroyGizmo?.();
    destroyGizmo = null;
    delete global.BABYLON;
  });

  test("selecting a node creates ring, ticks, and handle", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const torus = babylon.createdMeshes.find((m) => m.name === "versionRing");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const arrow = babylon.createdMeshes.find((m) => m.name === "versionArrow");
    expect(torus).toBeDefined();
    expect(handle).toBeDefined();
    expect(arrow).toBeDefined();
    expect(babylon.createdMeshes.filter((m) => m.name.startsWith("versionTick")).length).toBe(3);
    expect(torus.material.disableLighting).toBe(true);
    expect(handle.material.disableLighting).toBe(true);
  });

  test("dragging handle commits the landed version and manages camera", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;

    pointerCb({ type: PET.POINTERDOWN, pickInfo: { pickedMesh: handle } });
    expect(camera.detachControl).toHaveBeenCalled();

    // Ray hits the ring plane at the oldest version's position (180° for n=3
    // → world (-radius, 0, 0); root sits at the origin in this test).
    const radius = 0.5; // MIN_RING_RADIUS: no meshes registered → fallback
    scene.createPickingRay.mockReturnValue({
      origin: new babylon.Vector3(-radius, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    });
    pointerCb({ type: PET.POINTERMOVE });

    pointerCb({ type: PET.POINTERUP });
    expect(camera.attachControl).toHaveBeenCalled();
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });

  test("hovering the handle swaps to the hover material", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const baseMat = handle.material;
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;

    pointerCb({ type: PET.POINTERMOVE, pickInfo: { pickedMesh: handle } });
    expect(handle.material).not.toBe(baseMat);

    pointerCb({ type: PET.POINTERMOVE, pickInfo: { pickedMesh: null } });
    expect(handle.material).toBe(baseMat);
  });

  test("disposing the gizmo removes the pointer observer", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    emit(EVENTS.NODE_DESELECTED);
    expect(scene.onPointerObservable.remove).toHaveBeenCalled();
  });

  test("deselecting node disposes gizmo and its materials", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const materials = babylon.createdMeshes
      .map((m) => m.material)
      .filter(Boolean);
    expect(materials.length).toBeGreaterThan(0);

    emit(EVENTS.NODE_DESELECTED);

    expect(babylon.disposed.length).toBeGreaterThan(0);
    expect(materials.every((m) => m._disposed)).toBe(true);
  });

  test("scene empty disposes the gizmo", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.length).toBeGreaterThan(0);

    emit(EVENTS.SCENE_EMPTY);
    expect(babylon.disposed.length).toBeGreaterThan(0);
  });

  test("scene cleared disposes the gizmo and hides the badge", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.length).toBeGreaterThan(0);

    const badge = document.getElementById("modelClockBadge");
    emit(EVENTS.SCENE_CLEARED);
    expect(babylon.disposed.length).toBeGreaterThan(0);
    expect(badge.hidden).toBe(true);
  });

  test("destroy() unsubscribes and removes render callback", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const createdCount = babylon.createdMeshes.length;
    expect(createdCount).toBeGreaterThan(0);

    scene.onBeforeRenderObservable.remove.mockClear();
    destroyGizmo();

    expect(scene.onBeforeRenderObservable.remove).toHaveBeenCalled();

    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.length).toBe(createdCount);
  });

  test("switching away from time mode disposes the ring", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeDefined();

    state.transformMode = "translate";
    emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "translate" });
    expect(babylon.disposed.length).toBeGreaterThan(0);
    expect(document.getElementById("modelClockBadge").hidden).toBe(true);
  });

  test("no ring is built outside time mode; entering time mode builds it", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.transformMode = "translate";
    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeUndefined();

    state.transformMode = "time";
    emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "time" });
    expect(babylon.createdMeshes.find((m) => m.name === "versionRing")).toBeDefined();
  });

  test("deselecting disposes the gizmo", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.length).toBeGreaterThan(0);

    state.highlightedNodeId = null;
    emit(EVENTS.NODE_DESELECTED);
    expect(babylon.disposed.length).toBeGreaterThan(0);
  });

  test("arrow keys step version only in time mode", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c2");

    storeMock.loadVersion.mockClear();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");

    storeMock.loadVersion.mockClear();
    state.transformMode = "translate";
    emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: "translate" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(storeMock.loadVersion).not.toHaveBeenCalled();
  });

  test("badge element is created and positioned", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const badge = document.getElementById("modelClockBadge");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("v3");
  });
});
