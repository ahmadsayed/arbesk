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
  }

  class MockTransformNode {
    constructor(name, scene) {
      this.name = name;
      this.scene = scene;
      this.position = new MockVector3();
      this.rotation = new MockVector3();
      this.scaling = new MockVector3(1, 1, 1);
      this.parent = null;
      this._disposed = false;
    }
    dispose() {
      this._disposed = true;
      disposed.push(this);
    }
    setParent(p) {
      this.parent = p;
    }
    getAbsolutePosition() {
      return this.position.clone();
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
    dispose() {
      super.dispose();
    }
  }

  class MockObservable {
    constructor() {
      this._callbacks = [];
    }
    add(fn) {
      this._callbacks.push(fn);
    }
  }

  class MockPointerDragBehavior {
    constructor(_options) {
      this.onDragStartObservable = new MockObservable();
      this.onDragObservable = new MockObservable();
      this.onDragEndObservable = new MockObservable();
      this.detach = jest.fn();
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
    },
    PointerDragBehavior: MockPointerDragBehavior,
    StandardMaterial: class {
      constructor(name, scene) {
        this.name = name;
        this.scene = scene;
        this.diffuseColor = null;
        this.emissiveColor = null;
        this.alpha = 1;
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
});

describe("model-clock-gizmo lifecycle", () => {
  let viewport, scene, camera, babylon;

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

    storeMock.versionsForNode.mockReturnValue(ENTRIES);
    storeMock.loadVersion.mockClear();

    scene = {
      onBeforeRenderObservable: { add: jest.fn(), remove: jest.fn() },
      getTransformMatrix: () => ({}),
      getEngine: () => ({
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
      }),
    };
    camera = { viewport: { toGlobal: () => ({ width: 800, height: 600 }) } };
  });

  afterEach(() => {
    delete global.BABYLON;
  });

  test("selecting a node creates ring, ticks, and handle", async () => {
    const { initModelClockGizmo } = await import(
      "../../frontend/src/js/ui/model-clock-gizmo.js"
    );
    initModelClockGizmo(scene, camera);

    state.highlightedNodeId = "node-a";
    state.nodeAnchors.set("node-a", new babylon.TransformNode("anchor", scene));
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });

    const torus = babylon.createdMeshes.find((m) => m.name === "versionRing");
    const handle = babylon.createdMeshes.find((m) => m.name === "versionHandle");
    expect(torus).toBeDefined();
    expect(handle).toBeDefined();
    expect(babylon.createdMeshes.filter((m) => m.name.startsWith("versionTick")).length).toBe(3);
  });
});
