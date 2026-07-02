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
    };

    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    // Reset shared state.
    state.gizmoManager = null;
    state.transformMode = null;
    state.highlightedNodeId = null;
    state.nodeAnchors = new Map();

    initTransformGizmo({}, null);
  });

  afterEach(() => {
    viewport.remove();
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
});
