/**
 * @jest-environment jsdom
 */
import { expect, test, describe, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import { initTransformGizmo } from "../../frontend/src/js/ui/transform-gizmo.js";

describe("transform-gizmo toolbar", () => {
  let viewport;

  beforeEach(() => {
    // Provide a minimal BABYLON global for initTransformGizmo.
    global.BABYLON = {
      GizmoManager: class {
        constructor() {
          this.positionGizmoEnabled = false;
          this.rotationGizmoEnabled = false;
          this.scaleGizmoEnabled = false;
          this.usePointerToAttachGizmos = false;
          this.clearGizmoOnEmptyPointerEvent = false;
          this.gizmos = {
            positionGizmo: { onDragEndObservable: { add: () => {} } },
            rotationGizmo: { onDragEndObservable: { add: () => {} } },
            scaleGizmo: { onDragEndObservable: { add: () => {} } },
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
      Vector3: {
        Zero: () => {
          const chain = {
            addInPlace: () => chain,
            scaleInPlace: () => chain,
          };
          return chain;
        },
      },
      Quaternion: { Identity: () => ({ copyFrom: () => {} }) },
    };

    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    // Reset shared state.
    state.gizmoManager = null;
    state.transformMode = null;
    state.highlightedNodeId = null;
    state.selectedNodeIds = new Set();
    state.nodeAnchors = new Map();

    initTransformGizmo({}, null);
  });

  afterEach(() => {
    viewport.remove();
    state.selectedNodeIds = new Set();
    delete global.BABYLON;
  });

  test("toolbar buttons are re-enabled after deselect then reselect", () => {
    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);

    // First selection enables the toolbar and defaults to translate.
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    const buttons = () =>
      Array.from(viewport.querySelectorAll(".transform-tool"));

    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(buttons().find((b) => b.dataset.mode === "translate")?.classList.contains("active")).toBe(true);

    // Deselect disables the toolbar.
    state.highlightedNodeId = null;
    emit(EVENTS.NODE_DESELECTED);
    expect(buttons().some((b) => b.disabled)).toBe(true);

    // Reselect should re-enable the toolbar.
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });

  test("time mode button exists, disables all gizmos, and emits mode event", async () => {
    const { on, EVENTS } = await import("../../frontend/src/js/events/bus.js");
    const modes = [];
    const off = on(EVENTS.TRANSFORM_MODE_CHANGED, (e) => modes.push(e.mode));

    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    expect(modes).toEqual(["translate"]);

    const timeBtn = viewport.querySelector('.transform-tool[data-mode="time"]');
    expect(timeBtn).toBeTruthy();
    timeBtn.click();

    expect(state.transformMode).toBe("time");
    expect(modes).toEqual(["translate", "time"]);
    expect(state.gizmoManager.positionGizmoEnabled).toBe(false);
    expect(state.gizmoManager.rotationGizmoEnabled).toBe(false);
    expect(state.gizmoManager.scaleGizmoEnabled).toBe(false);
    expect(timeBtn.classList.contains("active")).toBe(true);
    off();
  });

  test("V key switches to time mode", () => {
    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "v" }));
    expect(state.transformMode).toBe("time");
  });

  test("time mode is disabled for multi-selections", () => {
    const mkAnchor = () => ({
      isDisposed: () => false,
      getAbsolutePosition: () => ({}),
    });
    state.nodeAnchors.set("node-1", mkAnchor());
    state.nodeAnchors.set("node-2", mkAnchor());
    state.highlightedNodeId = "node-2";
    state.selectedNodeIds = new Set(["node-1", "node-2"]);
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-2", mesh: null });

    const timeBtn = viewport.querySelector('.transform-tool[data-mode="time"]');
    expect(timeBtn.disabled).toBe(true);
    expect(
      viewport.querySelector('.transform-tool[data-mode="translate"]').disabled
    ).toBe(false);

    // The keyboard shortcut is refused too.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "v" }));
    expect(state.transformMode).toBe("translate");
  });

  test("growing the selection past one node leaves time mode", () => {
    const mkAnchor = () => ({
      isDisposed: () => false,
      getAbsolutePosition: () => ({}),
    });
    state.nodeAnchors.set("node-1", mkAnchor());
    state.nodeAnchors.set("node-2", mkAnchor());
    state.highlightedNodeId = "node-1";
    state.selectedNodeIds = new Set(["node-1"]);
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    viewport.querySelector('.transform-tool[data-mode="time"]').click();
    expect(state.transformMode).toBe("time");

    state.selectedNodeIds = new Set(["node-1", "node-2"]);
    emit(EVENTS.SELECTION_CHANGED, { nodeIds: ["node-1", "node-2"] });
    expect(state.transformMode).toBe("translate");
  });
});
