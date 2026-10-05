// @test-env dom
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  initTransformGizmo,
  dropSelectionToFloor,
  resetSelectionTransform,
} from "../../frontend/src/js/ui/transform-gizmo.js";
import { popUndoEntry, clearUndoStacks } from "../../frontend/src/js/engine/undo-stack.js";
import {
  isEditing,
  setEditing,
  _resetEditModeForTesting,
} from "../../frontend/src/js/state/edit-mode.js";
import { walletState } from "../../frontend/src/js/state/wallet-state.js";
import { _resetForTesting as resetAssetStore } from "@arbesk/asset-core/domain/asset-store.js";
import { enterEditForTest } from "./helpers/edit-mode.js";

const dragEnd = () => state.gizmoManager.gizmos.positionGizmo.onDragEndObservable.fire();

describe("transform-gizmo toolbar", () => {
  let viewport;

  beforeEach(() => {
    _resetEditModeForTesting();
    walletState.set({ walletAddress: null });
    resetAssetStore();
    // Provide a minimal BABYLON global for initTransformGizmo.
    global.BABYLON = {
      GizmoManager: class {
        constructor() {
          this.positionGizmoEnabled = false;
          this.rotationGizmoEnabled = false;
          this.usePointerToAttachGizmos = false;
          this.clearGizmoOnEmptyPointerEvent = false;
          const obs = () => {
            const fns = [];
            return { add: (f) => fns.push(f), fire: () => fns.forEach((f) => f()) };
          };
          this.gizmos = {
            positionGizmo: {
              onDragStartObservable: obs(),
              onDragEndObservable: obs(),
              snapDistance: 0,
              // Babylon disables the plane handles until planarGizmoEnabled is set.
              planarGizmoEnabled: false,
              yPlaneGizmo: { isEnabled: false },
              yGizmo: { isEnabled: true },
              xPlaneGizmo: { isEnabled: true },
              zPlaneGizmo: { isEnabled: true },
            },
            rotationGizmo: {
              onDragStartObservable: obs(),
              onDragEndObservable: obs(),
              snapDistance: 0,
            },
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
        constructor(x, y, z) {
          Object.assign(this, { x, y, z });
        }
        static Zero() {
          const chain = {
            addInPlace: () => chain,
            scaleInPlace: () => chain,
          };
          return chain;
        }
        static TransformNormal(v) {
          return v;
        }
      },
      Matrix: {
        Invert: (m) => m,
        // Enough of a matrix that any move/rotation/scale changes the snapshot.
        Compose: (s, r, p) => ({
          m: [s.x, r.w, p.x, p.y, p.z, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        }),
      },
      Quaternion: { Identity: () => ({ w: 1, copyFrom() {} }) },
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
    state.isGizmoDragging = false;

    initTransformGizmo({}, null);
  });

  afterEach(() => {
    viewport.remove();
    state.selectedNodeIds = new Set();
    delete global.BABYLON;
  });

  test("toolbar buttons are re-enabled after deselect then reselect", () => {
    enterEditForTest();
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
    const { on, EVENTS } = await import("@arbesk/asset-core/events/bus.js");
    const modes = [];
    const off = on(EVENTS.TRANSFORM_MODE_CHANGED, (e) => modes.push(e.mode));

    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    expect(modes).toEqual([]);

    const timeBtn = viewport.querySelector('.transform-tool[data-mode="time"]');
    expect(timeBtn).toBeTruthy();
    timeBtn.click();

    expect(state.transformMode).toBe("time");
    expect(modes).toEqual(["time"]);
    expect(state.gizmoManager.positionGizmoEnabled).toBe(false);
    expect(state.gizmoManager.rotationGizmoEnabled).toBe(false);
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
    enterEditForTest();
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
    expect(state.transformMode).toBe(null);
  });
  test("View mode: selecting attaches no gizmo and shows only Edit + Time", () => {
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

    expect(state.transformMode).toBe(null);
    expect(attach).not.toHaveBeenCalledWith(state.nodeAnchors.get("node-1"));
    const visible = (sel) => !viewport.querySelector(sel).hidden;
    expect(visible('[data-mode="translate"]')).toBe(false);
    expect(visible('[data-mode="time"]')).toBe(true);
    expect(viewport.querySelector('[data-mode="scale"]')).toBeNull();
  });

  test("Edit button is hidden when the user cannot save", () => {
    expect(document.getElementById("editModeBtn").hidden).toBe(true);
    enterEditForTest();
    const btn = document.getElementById("editModeBtn");
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe("Done");
    expect(btn.getAttribute("aria-label")).toBe("Done editing (E)");
  });

  test("entering Edit selects Move and attaches to the selection", () => {
    const anchor = { isDisposed: () => false };
    state.nodeAnchors.set("node-1", anchor);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");

    enterEditForTest();
    expect(state.transformMode).toBe("translate");
    expect(attach).toHaveBeenLastCalledWith(anchor);
    expect(viewport.querySelector('[data-mode="translate"]').hidden).toBe(false);
    expect(viewport.querySelector('[data-mode="time"]').hidden).toBe(true);
  });

  test("auto-repeated E keydown does not toggle Edit", () => {
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", repeat: true }));
    expect(isEditing()).toBe(true);
  });

  test("keys: T/R do nothing in View; E toggles; S is gone; V works in both", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    const press = (key, opts = {}) =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));

    press("t");
    press("r");
    press("s");
    expect(state.transformMode).toBe(null);

    // make canEdit() true, then use the real key
    enterEditForTest();
    press("e"); // E toggles back out
    expect(isEditing()).toBe(false);
    press("e");
    expect(isEditing()).toBe(true);
    press("r");
    expect(state.transformMode).toBe("rotate");
    press("s");
    expect(state.transformMode).toBe("rotate"); // no scale tool

    press("v"); // leaves Edit, enters Time
    expect(isEditing()).toBe(false);
    expect(state.transformMode).toBe("time");
  });

  test("leaving Edit clears the placement mode and detaches", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const attach = jest.spyOn(state.gizmoManager, "attachToNode");
    setEditing(false);
    expect(state.transformMode).toBe(null);
    expect(attach).toHaveBeenLastCalledWith(null);
  });

  test("leaving Edit mid-drag detaches only after the drag ends", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    state.isGizmoDragging = true;
    setEditing(false);
    expect(state.transformMode).toBe("translate"); // still mid-drag
    state.isGizmoDragging = false;
    dragEnd(); // fires the position gizmo's onDragEndObservable
    expect(state.transformMode).toBe(null);
  });

  test("re-entering Edit mid-drag (E,E) is not undone at drag end", () => {
    state.nodeAnchors.set("node-1", { isDisposed: () => false });
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    state.isGizmoDragging = true;
    setEditing(false);
    setEditing(true);
    state.isGizmoDragging = false;
    dragEnd();
    expect(state.transformMode).toBe("translate");
  });

  // An anchor the real readNodeTransformMatrix + placement adapter can drive.
  function liveAnchor(y) {
    const a = {
      parent: null,
      isDisposed: () => false,
      scaling: { x: 1, y: 1, z: 1 },
      rotationQuaternion: { w: 1 },
      position: {
        x: 0,
        y,
        z: 0,
        addInPlace(v) {
          this.x += v.x;
          this.y += v.y;
          this.z += v.z;
          return this;
        },
      },
      computeWorldMatrix() {},
      getHierarchyBoundingVectors: () => ({
        min: { x: 0, y: a.position.y, z: 0 },
        max: { x: 1, y: a.position.y + 1, z: 1 },
      }),
    };
    return a;
  }

  test("Edit applies floor lock and snapping to the position gizmo", () => {
    state.nodeAnchors.set("node-1", liveAnchor(0));
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const pg = state.gizmoManager.gizmos.positionGizmo;
    expect(pg.planarGizmoEnabled).toBe(true);
    expect(pg.yPlaneGizmo.isEnabled).toBe(true); // the XZ drag plane
    expect(pg.yGizmo.isEnabled).toBe(false);
    expect(pg.xPlaneGizmo.isEnabled).toBe(false);
    expect(pg.zPlaneGizmo.isEnabled).toBe(false);
    expect(pg.snapDistance).toBe(2); // grid scale 1 (no groundGrid in the mock scene)

    document.getElementById("lockFloorBtn").click();
    expect(document.getElementById("lockFloorBtn").getAttribute("aria-pressed")).toBe("false");
    expect(pg.planarGizmoEnabled).toBe(true);
    expect(pg.yPlaneGizmo.isEnabled).toBe(true);
    expect(pg.yGizmo.isEnabled).toBe(true);
    expect(pg.xPlaneGizmo.isEnabled).toBe(true);
    expect(pg.zPlaneGizmo.isEnabled).toBe(true);
    document.getElementById("lockFloorBtn").click(); // restore the module default
  });

  test("Alt disables snapping until released", () => {
    state.nodeAnchors.set("node-1", liveAnchor(0));
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const pg = state.gizmoManager.gizmos.positionGizmo;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(pg.snapDistance).toBe(0);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    expect(pg.snapDistance).toBe(2);
  });

  test("rotation snap mirrors the 15° step; Alt suspends both; window blur restores both", () => {
    state.nodeAnchors.set("node-1", liveAnchor(0));
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    const pg = state.gizmoManager.gizmos.positionGizmo;
    const rg = state.gizmoManager.gizmos.rotationGizmo;
    expect(rg.snapDistance).toBe(Math.PI / 12);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true }));
    expect(rg.snapDistance).toBe(0);

    window.dispatchEvent(new Event("blur"));
    expect(pg.snapDistance).toBe(2);
    expect(rg.snapDistance).toBe(Math.PI / 12);
  });

  test("floor-locked Move grounds a floating selection at drag start, in the Move entry", () => {
    clearUndoStacks();
    const a = liveAnchor(4);
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();

    state.gizmoManager.gizmos.positionGizmo.onDragStartObservable.fire();
    expect(a.position.y).toBe(0);

    state.gizmoManager.gizmos.positionGizmo.onDragEndObservable.fire();
    const entry = popUndoEntry();
    expect(entry.label).toBe("Move");
    // Matrix.Compose(scale, rotation, position) mock layout: m[3] is position.y.
    expect(entry.items[0].before[3]).toBe(4);
    expect(entry.items[0].after[3]).toBe(0);
    expect(entry.items[0].before).not.toEqual(entry.items[0].after);
  });

  test("Rotate re-grounds on drag end, in the Rotate entry", () => {
    clearUndoStacks();
    const a = liveAnchor(0);
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(state.transformMode).toBe("rotate");

    state.gizmoManager.gizmos.rotationGizmo.onDragStartObservable.fire();
    // Mid-drag: the rotation tips the part, pushing it through the floor.
    a.rotationQuaternion.w = 0.5;
    a.position.y = 3;
    state.gizmoManager.gizmos.rotationGizmo.onDragEndObservable.fire();

    expect(a.position.y).toBe(0);
    const entry = popUndoEntry();
    expect(entry.label).toBe("Rotate");
  });

  test("G drops the selection to the floor as one undo step", () => {
    clearUndoStacks();
    const a = liveAnchor(4);
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    expect(a.position.y).toBe(4); // View mode: G does nothing
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    expect(a.position.y).toBe(0);
    expect(popUndoEntry().label).toBe("Drop to floor");
  });

  test("Shift+R resets rotation/position but not scale", () => {
    clearUndoStacks();
    const a = liveAnchor(3);
    a.position.x = 5;
    a.rotationQuaternion = { w: 0.5 };
    a.scaling = { x: 2, y: 2, z: 2 };
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });
    enterEditForTest();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "R", shiftKey: true }));
    expect(a.rotationQuaternion.w).toBe(1);
    expect(a.position.y).toBe(0);
    expect(a.scaling).toEqual({ x: 2, y: 2, z: 2 });
    expect(popUndoEntry().label).toBe("Reset transform");
  });

  test("placement buttons are disabled with no selection", () => {
    enterEditForTest();
    expect(document.getElementById("dropToFloorBtn").disabled).toBe(true);
    expect(document.getElementById("resetTransformBtn").disabled).toBe(true);
  });

  test("exported placement actions are no-ops outside Edit", () => {
    clearUndoStacks();
    const a = liveAnchor(4);
    state.nodeAnchors.set("node-1", a);
    state.highlightedNodeId = "node-1";
    dropSelectionToFloor();
    resetSelectionTransform();
    expect(a.position.y).toBe(4);
    expect(popUndoEntry()).toBeNull();
  });
});
