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
    scale(s) {
      return new MockVector3(this.x * s, this.y * s, this.z * s);
    }
    length() {
      return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }
    normalize() {
      const len = this.length();
      if (len === 0) return new MockVector3(0, 0, 0);
      return this.scale(1 / len);
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
    lookAt(_target) {
      // Euler rotation stays zero; rotationQuaternion will be overwritten by
      // the caller using BABYLON.Quaternion.FromEulerAngles.
      this.rotation = new MockVector3(0, 0, 0);
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
    bakeCurrentTransformIntoVertices() {
      // Vertex data isn't modeled in the mock; transform baking is a no-op.
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
    static FromEulerAngles(_x, _y, _z) {
      return new MockQuaternion();
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
      CreateDisc: (name, opts, scene) => new MockMesh(name, scene),
    },
    Quaternion: MockQuaternion,
    PointerEventTypes: { POINTERDOWN: 1, POINTERUP: 2, POINTERMOVE: 4 },
    UtilityLayerRenderer: null,
    Material: { MATERIAL_ALPHABLEND: 2 },
    Effect: { ShadersStore: {} },
    ShaderMaterial: class {
      constructor(name, scene, shaderPath, options) {
        this.name = name;
        this.scene = scene;
        this.shaderPath = shaderPath;
        this.options = options;
        this.backFaceCulling = true;
        this.floats = {};
        this._disposed = false;
      }
      setFloat(key, value) {
        this.floats[key] = value;
        return this;
      }
      dispose() {
        this._disposed = true;
      }
    },
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
    expect(_ringRadiusFromBounds({ x: -1, y: 0, z: -1 }, { x: 1, y: 2, z: 1 })).toBeCloseTo(1.15, 5);
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
      position: new babylon.Vector3(0, 0, -10),
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

  test("selecting a node creates face, ring, ticks, knob handle with rim — and no arrow", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const face = babylon.createdMeshes.find((m) => m.name === "modelClockFace");
    const torus = babylon.createdMeshes.find((m) => m.name === "versionRing");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const rim = babylon.createdMeshes.find((m) => m.name === "versionHandleRim");
    const arrow = babylon.createdMeshes.find((m) => m.name === "versionArrow");
    expect(face).toBeDefined();
    expect(torus).toBeDefined();
    expect(handle).toBeDefined();
    expect(rim).toBeDefined();
    // The arrow is gone — direction is communicated by the progress arc.
    expect(arrow).toBeUndefined();
    expect(babylon.createdMeshes.filter((m) => m.name.startsWith("versionTick")).length).toBe(3);
    expect(torus.material.disableLighting).toBe(true);
    expect(handle.material.disableLighting).toBe(true);
    // Knob is a flat disc facing the viewer, seated on the ring plane.
    expect(handle.rotation.x).toBeCloseTo(Math.PI / 2, 5);
    // Rim rides the knob so it follows every drag for free.
    expect(rim.parent).toBe(handle);
    // Translucent clock parts use alpha blending; knob and rim stay opaque.
    expect(face.material.alpha).toBeLessThan(1);
    expect(torus.material.alpha).toBeLessThan(1);
    expect(handle.material.alpha).toBe(1);
    expect(rim.material.alpha).toBe(1);
  });

  test("every tick gets an always-visible label showing its own version, active one highlighted", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const labels = Array.from(document.querySelectorAll(".model-clock-tick-label"));
    expect(labels.length).toBe(3);
    expect(labels.map((el) => el.textContent)).toEqual(["v1", "v2", "v3"]);

    // ENTRIES[2] (v3) is the active CID per storeMock.getState().
    expect(labels[2].classList.contains("active")).toBe(true);
    expect(labels[0].classList.contains("active")).toBe(false);
    expect(labels[1].classList.contains("active")).toBe(false);
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

  test("badge and tick label reflect the hovered version live during drag, not just after release", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const renderCb = scene.onBeforeRenderObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;

    // The badge id lives on whichever tick label is currently "current" —
    // re-query it each time rather than caching the element, since the id
    // moves between elements as the active/hover tick changes.
    expect(document.getElementById("modelClockBadge").textContent).toBe("v3");

    pointerCb({ type: PET.POINTERDOWN, pickInfo: { pickedMesh: handle } });

    // Drag toward the oldest version's position (180° for n=3) without releasing.
    const radius = 0.5;
    scene.createPickingRay.mockReturnValue({
      origin: new babylon.Vector3(-radius, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    });
    pointerCb({ type: PET.POINTERMOVE });
    renderCb(); // simulate the next animation frame while still dragging

    expect(document.getElementById("modelClockBadge").textContent).toBe("v1");
    const labels = Array.from(document.querySelectorAll(".model-clock-tick-label"));
    expect(labels[0].classList.contains("hover")).toBe(true);
    expect(labels[2].classList.contains("active")).toBe(true); // real active version unchanged until commit

    pointerCb({ type: PET.POINTERUP });
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

  test("scene cleared disposes the gizmo and removes the badge", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(babylon.createdMeshes.length).toBeGreaterThan(0);
    expect(document.getElementById("modelClockBadge")).toBeTruthy();

    emit(EVENTS.SCENE_CLEARED);
    expect(babylon.disposed.length).toBeGreaterThan(0);
    // No standalone badge element persists — it's the id of whichever tick
    // label is current, and all tick labels are removed with the gizmo.
    expect(document.getElementById("modelClockBadge")).toBeNull();
  });

  test("clock rebuilds for the same node after scene ready", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const liveRings = () =>
      babylon.createdMeshes.filter((m) => m.name === "versionRing" && !m._disposed);
    expect(liveRings().length).toBe(1);

    emit(EVENTS.SCENE_CLEARED);
    expect(liveRings().length).toBe(0);
    expect(document.getElementById("modelClockBadge")).toBeNull();

    // Simulate the new scene finishing load with the same node available.
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.SCENE_READY, { manifestCid: "c2" });
    expect(liveRings().length).toBe(1);
    expect(document.getElementById("modelClockBadge")).toBeTruthy();
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
    expect(document.getElementById("modelClockBadge")).toBeNull();
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

  test("progress arc uses the clipping shader and sweeps from v1 to the active version", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const arc = babylon.createdMeshes.find((m) => m.name === "versionArc");
    expect(arc).toBeDefined();
    expect(arc.material.shaderPath).toBe("modelClockArc");
    // n=3: v1 sits at 150°, active v3 at -90° → clockwise sweep of 240°.
    expect(arc.material.floats.startAngle).toBeCloseTo((150 * Math.PI) / 180, 5);
    expect(arc.material.floats.sweep).toBeCloseTo((240 * Math.PI) / 180, 5);
    // Both shader sources were registered.
    expect(babylon.Effect.ShadersStore.modelClockArcVertexShader).toContain("worldViewProjection");
    expect(babylon.Effect.ShadersStore.modelClockArcFragmentShader).toContain("discard");
  });

  test("dragging the knob updates the arc sweep uniform live", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    destroyGizmo = initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const arc = babylon.createdMeshes.find((m) => m.name === "versionArc");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    const pointerCb = scene.onPointerObservable.add.mock.calls[0][0];
    const PET = babylon.PointerEventTypes;
    const sweepBefore = arc.material.floats.sweep;

    pointerCb({ type: PET.POINTERDOWN, pickInfo: { pickedMesh: handle } });
    scene.createPickingRay.mockReturnValue({
      origin: new babylon.Vector3(-0.5, 0, -10),
      direction: new babylon.Vector3(0, 0, 1),
    });
    pointerCb({ type: PET.POINTERMOVE });

    expect(arc.material.floats.sweep).not.toBeCloseTo(sweepBefore, 5);
    pointerCb({ type: PET.POINTERUP });
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
