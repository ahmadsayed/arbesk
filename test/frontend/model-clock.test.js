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
  beforeAll,
} from "@jest/globals";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import { state } from "../../frontend/src/js/engine/state.js";

let _subscriber = null;
const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 1, timestamp: null },
];
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
  activeIndex: jest.fn(() => 1),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => ENTRIES),
  _deps: {},
};
jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);

let initModelClock;
beforeAll(async () => {
  ({ initModelClock } = await import(
    "../../frontend/src/js/ui/model-clock.js"
  ));
});

describe("model-clock", () => {
  let viewport, scene, repositionFns;

  beforeEach(() => {
    document.getElementById("modelClock")?.remove();
    document.getElementById("viewport")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    repositionFns = [];
    scene = {
      onBeforeRenderObservable: { add: (fn) => repositionFns.push(fn) },
      getTransformMatrix: () => ({}),
      getEngine: () => ({
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
      }),
    };
    state.highlightedNodeId = null;
    state.isGizmoDragging = false;
    state.nodeMeshes = new Map();
    storeMock.versionsForNode.mockReturnValue(ENTRIES);
    storeMock.loadVersion.mockClear();

    global.BABYLON = {
      Vector3: class V3 {
        constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
        static Minimize(a, b) {
          return new V3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
        }
        static Maximize(a, b) {
          return new V3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
        }
        static Project() { return { x: 400, y: 200, z: 0.5 }; }
        clone() { return new V3(this.x, this.y, this.z); }
      },
      Matrix: { Identity: () => ({}) },
    };

    initModelClock(scene, { viewport: { toGlobal: () => ({}) } });
  });

  afterEach(() => {
    delete global.BABYLON;
  });

  test("hidden until a node with history is selected", () => {
    const root = document.getElementById("modelClock");
    expect(root.hidden).toBe(true);

    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(root.hidden).toBe(false);
    expect(storeMock.versionsForNode).toHaveBeenCalledWith("node-a");

    emit(EVENTS.NODE_DESELECTED);
    expect(root.hidden).toBe(true);
  });

  test("filtered dial: aria-valuemax reflects the node's versions", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const dial = document.querySelector("#modelClock .version-clock");
    expect(dial.getAttribute("aria-valuemax")).toBe("1"); // 2 entries
  });

  test("commit loads the underlying chain version", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const dial = document.querySelector("#modelClock .version-clock");
    dial.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true })
    );
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });

  test("reposition hides during gizmo drag and when meshes are gone", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const root = document.getElementById("modelClock");
    const reposition = repositionFns[0];

    // No meshes → invisible.
    reposition();
    expect(root.style.visibility).toBe("hidden");

    // Meshes present → positioned via projection.
    state.nodeMeshes.set("node-a", [
      {
        isDisposed: () => false,
        getBoundingInfo: () => ({
          boundingBox: {
            minimumWorld: new global.BABYLON.Vector3(-1, 0, -1),
            maximumWorld: new global.BABYLON.Vector3(1, 2, 1),
          },
        }),
      },
    ]);
    reposition();
    expect(root.style.visibility).toBe("");
    expect(root.style.transform).toContain("400px");

    // Mid-drag → invisible.
    state.isGizmoDragging = true;
    reposition();
    expect(root.style.visibility).toBe("hidden");
  });
});
