/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import {
  clearUndoStacks,
  canUndo,
  canRedo,
  peekUndoLabel,
  popUndoEntry,
} from "../../frontend/src/js/engine/undo-stack.js";
import { initTransformGizmo } from "../../frontend/src/js/ui/transform-gizmo.js";

// Observable stub that stores callbacks so tests can fire them.
const observable = () => {
  const cbs = [];
  return { add: (cb) => cbs.push(cb), fire: () => cbs.forEach((cb) => cb()) };
};

let positionGizmo;
let dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

beforeEach(() => {
  dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // identity
  positionGizmo = {
    onDragStartObservable: observable(),
    onDragEndObservable: observable(),
  };
  global.BABYLON = {
    GizmoManager: class {
      constructor() {
        this.positionGizmoEnabled = false;
        this.rotationGizmoEnabled = false;
        this.scaleGizmoEnabled = false;
        this.usePointerToAttachGizmos = false;
        this.clearGizmoOnEmptyPointerEvent = false;
        this.gizmos = {
          positionGizmo,
          rotationGizmo: null,
          scaleGizmo: null,
        };
      }
      attachToNode() {}
    },
    TransformNode: class {
      constructor() {
        this.position = { copyFrom: () => {} };
        this.rotationQuaternion = { copyFrom: () => {} };
        this.scaling = { copyFromFloats: () => {} };
      }
      isDisposed() {
        return false;
      }
      computeWorldMatrix() {}
      dispose() {}
    },
    Vector3: class {
      static Zero() {
        const chain = { addInPlace: () => chain, scaleInPlace: () => chain };
        return chain;
      }
    },
    Quaternion: class {
      static Identity() {
        return {};
      }
    },
    Matrix: {
      Compose: () => ({ m: [...dragMatrix] }),
      FromValues: () => ({ decompose: () => true }),
    },
  };

  const viewport = document.createElement("div");
  viewport.id = "viewport";
  document.body.appendChild(viewport);

  state.gizmoManager = null;
  state.transformMode = null;
  state.highlightedNodeId = null;
  state.selectedNodeIds = new Set();
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
  state.isGizmoDragging = false;
  clearUndoStacks();

  initTransformGizmo({}, null);
  state.nodeAnchors.set("n1", {
    scaling: {},
    rotationQuaternion: null,
    position: {},
    isDisposed: () => false,
  });
  state.highlightedNodeId = "n1";
  emit(EVENTS.NODE_SELECTED, { nodeId: "n1", mesh: null });
});

afterEach(() => {
  document.getElementById("viewport")?.remove();
  delete global.BABYLON;
  clearUndoStacks();
});

describe("gizmo drag undo capture", () => {
  test("a drag that moves the node pushes one Move entry", () => {
    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1]; // moved
    positionGizmo.onDragEndObservable.fire();

    expect(canUndo()).toBe(true);
    expect(peekUndoLabel()).toBe("Move");
    const entry = popUndoEntry();
    expect(entry.type).toBe("transform");
    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].nodeId).toBe("n1");
    expect(entry.items[0].before[12]).toBe(0);
    expect(entry.items[0].after[12]).toBe(4);
    clearUndoStacks();
  });

  test("a click without movement pushes nothing", () => {
    positionGizmo.onDragStartObservable.fire();
    positionGizmo.onDragEndObservable.fire(); // same matrix
    expect(canUndo()).toBe(false);
  });

  test("toolbar has disabled undo/redo buttons that enable after a drag", () => {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1];
    positionGizmo.onDragEndObservable.fire();

    expect(undoBtn.disabled).toBe(false);
    expect(undoBtn.title).toContain("Move");
    expect(redoBtn.disabled).toBe(true);
  });

  test("toolbar undo button click consumes the entry", () => {
    positionGizmo.onDragStartObservable.fire();
    dragMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1];
    positionGizmo.onDragEndObservable.fire();

    document.getElementById("undoBtn").click();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
  });
});
