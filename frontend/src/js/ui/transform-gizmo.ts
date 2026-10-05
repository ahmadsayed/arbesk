/**
 * Viewport placement controls: the View/Edit toggle, the Move/Rotate gizmo,
 * and the side Undo/Redo/Grid strip.
 * @remarks View-only by default — the gizmo attaches only in Edit mode
 *   (state/edit-mode.ts). In Edit, Move is floor-locked and snapped (grid
 *   cell / 15°, Alt suspends snapping); Drop to floor and Reset transform
 *   act on the selection as one undo step each. Transform edits are staged and persisted on the
 *   next Save Draft / Publish. There is deliberately no scale gizmo: scale is
 *   a numeric Inspector edit, protecting print dimensions.
 */

import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "../engine/state.ts";
import type { TransformMode } from "../engine/state.ts";
import { undo, redo } from "../engine/undo-controller.ts";
import {
  attachToGroupPivot,
  startGroupDrag,
  applyGroupDrag,
  endGroupDrag,
  disposeGroupPivot,
  isGroupDragActive,
  topLevelAnchorsFor,
  shiftGroupPivotY,
} from "../engine/group-pivot.ts";
import { groundAnchors, resetAnchor } from "../engine/placement-actions.ts";
import { moveSnapStep, ROTATE_SNAP } from "../engine/placement.ts";
import {
  selectedIds,
  snapshotMatrices,
  commitTransformChange,
  type MatrixSnapshot,
} from "../engine/transform-commit.ts";
import {
  canEdit,
  isEditing,
  setEditing,
  toggleEditing,
  subscribeEditMode,
} from "../state/edit-mode.ts";

const TOOLBAR_ID = "transformToolbar";

/**
 * Toggles the viewport ground grid and in-scene axis lines.
 */
export function toggleGrid(): boolean {
  const grid = state.scene?.getMeshByName("groundGrid");
  if (!grid) return false;
  const visible = !grid.isEnabled();
  grid.setEnabled(visible);
  for (const name of ["axisX", "axisZ"]) {
    state.scene?.getMeshByName(name)?.setEnabled(visible);
  }
  const btn = document.getElementById("gridToggleBtn");
  if (btn) {
    btn.classList.toggle("active", visible);
    btn.setAttribute("aria-pressed", String(visible));
  }
  return visible;
}

const ICONS = {
  translate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l4-4 4 4"/><path d="M9 5v14"/><path d="M19 15l-4 4-4-4"/><path d="M15 19V5"/></svg>',
  rotate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 11a9 9 0 0 1 15.2-5.8L21.5 8"/><path d="M21.5 13a9 9 0 0 1-15.2 5.8L2.5 16"/></svg>',
  time:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  undo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  redo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
  grid:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>',
  floorLock:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><rect x="7" y="9" width="10" height="8"/><path d="M12 3v3"/></svg>',
  dropToFloor:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/></svg>',
  resetTransform:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
};

/**
 * Initializes the transform gizmo and its viewport toolbar.
 */
function initTransformGizmo(
  scene: BABYLON.Scene,
  _camera: BABYLON.ArcRotateCamera
): void {
  if (!scene || !BABYLON.GizmoManager) {
    console.warn("[GIZMO] Babylon GizmoManager not available");
    return;
  }
  if (state.gizmoManager) {
    console.warn("[GIZMO] already initialized");
    return;
  }

  const gizmoManager = new BABYLON.GizmoManager(scene);
  gizmoManager.positionGizmoEnabled = false;
  gizmoManager.rotationGizmoEnabled = false;
  gizmoManager.usePointerToAttachGizmos = false;
  gizmoManager.clearGizmoOnEmptyPointerEvent = false;

  state.gizmoManager = gizmoManager;
  state.transformMode = null;

  // Per-frame fan-out for group drags: the gizmo mutates the pivot; each
  // selected anchor follows via its drag-start relative matrix.
  scene.onBeforeRenderObservable?.add(() => {
    if (state.isGizmoDragging && isGroupDragActive()) applyGroupDrag();
  });

  createToolbar();
  wireEvents(gizmoManager);
  wireKeyboard();
  updateToolbarUI();

  console.log("[GIZMO] transform gizmo initialized");
}

// ── Undo capture ──
// Snapshot the selected anchors' matrices at drag start; at drag end push one
// undo entry per drag gesture covering every node that actually moved.

const _MODE_LABELS: Record<string, string> = {
  translate: "Move",
  rotate: "Rotate",
};

let _dragBefore: MatrixSnapshot | null = null;
// Transform mode captured at drag start so a mid-drag T/R keypress can't
// mislabel the undo entry.
let _dragMode: TransformMode = null;

// ── Placement constraints (Edit mode) ──
// Floor lock: Move drags on the XZ plane only; Rotate re-grounds on release.
// Snapping: one grid cell / 15°, suspended while Alt is held.

let _floorLocked = true;
let _altHeld = false;

function _gridScale(): number {
  return state.scene?.getMeshByName?.("groundGrid")?.scaling?.x ?? 1;
}

/** Sub-gizmos that leave the XZ plane: Y axis and the XY / YZ planes. */
const _OFF_FLOOR_SUBGIZMOS = ["yGizmo", "xPlaneGizmo", "zPlaneGizmo"];

/**
 * Babylon creates the position gizmo lazily (first `positionGizmoEnabled =
 * true`) with its plane handles off, so the XZ drag plane (`yPlaneGizmo`) is
 * switched on here, every time constraints are applied.
 */
function _constrainPositionGizmo(pg: any): void {
  if (!pg.planarGizmoEnabled) pg.planarGizmoEnabled = true;
  if (pg.yPlaneGizmo) pg.yPlaneGizmo.isEnabled = true;
  for (const name of _OFF_FLOOR_SUBGIZMOS) {
    if (pg[name]) pg[name].isEnabled = !_floorLocked;
  }
  pg.snapDistance = _altHeld ? 0 : moveSnapStep(_gridScale());
}

/** Re-applied after setMode because Babylon creates sub-gizmos lazily. */
function _applyGizmoConstraints(): void {
  const g = state.gizmoManager?.gizmos || {};
  if (g.positionGizmo) _constrainPositionGizmo(g.positionGizmo);
  if (g.rotationGizmo) g.rotationGizmo.snapDistance = _altHeld ? 0 : ROTATE_SNAP;
}

function _setAltHeld(held: boolean): void {
  if (_altHeld === held) return;
  _altHeld = held;
  _applyGizmoConstraints();
}

function _toggleFloorLock(): void {
  _floorLocked = !_floorLocked;
  _applyGizmoConstraints();
  updateToolbarUI();
}

function _selectionAnchors(): any[] {
  return topLevelAnchorsFor(selectedIds());
}

/** Runs one placement action on the selection as a single undo step. */
function _runPlacementAction(label: string, act: (anchors: any[]) => void): void {
  if (!isEditing()) return;
  const anchors = _selectionAnchors();
  if (anchors.length === 0) return;
  const before = snapshotMatrices(selectedIds());
  act(anchors);
  commitTransformChange(label, before);
  // Re-centre the multi-selection pivot on the moved group.
  if (state.selectedNodeIds.size > 1 && state.gizmoManager) attachToGroupPivot(state.gizmoManager);
}

export function dropSelectionToFloor(): void {
  _runPlacementAction("Drop to floor", (anchors) => {
    groundAnchors(anchors);
  });
}

export function resetSelectionTransform(): void {
  _runPlacementAction("Reset transform", (anchors) => {
    for (const a of anchors) resetAnchor(a);
  });
}

const ACTIONS: Record<string, () => void> = {
  undo,
  redo,
  toggleGrid: () => {
    toggleGrid();
  },
  toggleEdit: () => {
    toggleEditing();
  },
  toggleFloorLock: _toggleFloorLock,
  dropToFloor: dropSelectionToFloor,
  resetTransform: resetSelectionTransform,
};

function createToolbar(): void {
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  if (document.getElementById(TOOLBAR_ID)) return;

  const toolbar = document.createElement("div");
  toolbar.id = TOOLBAR_ID;
  toolbar.className = "transform-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Transform tools");

  toolbar.innerHTML = `
    <button class="btn btn-flat btn-sm transform-tool" data-mode="translate" data-edit-only aria-label="Move (T)" title="Move (T)">
      ${ICONS.translate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="rotate" data-edit-only aria-label="Rotate (R)" title="Rotate (R)">
      ${ICONS.rotate}
    </button>
    <span class="transform-toolbar-sep" data-edit-only aria-hidden="true"></span>
    <button id="lockFloorBtn" class="btn btn-flat btn-sm active" data-action="toggleFloorLock" data-edit-only aria-pressed="true" aria-label="Lock to floor" title="Lock to floor">
      ${ICONS.floorLock}
    </button>
    <button id="dropToFloorBtn" class="btn btn-flat btn-sm placement-action" data-action="dropToFloor" data-edit-only aria-label="Drop to floor (G)" title="Drop to floor (G)">
      ${ICONS.dropToFloor}
    </button>
    <button id="resetTransformBtn" class="btn btn-flat btn-sm placement-action" data-action="resetTransform" data-edit-only aria-label="Reset transform (Shift+R)" title="Reset transform (Shift+R)">
      ${ICONS.resetTransform}
    </button>
    <span class="transform-toolbar-sep" data-edit-only aria-hidden="true"></span>
    <button id="editModeBtn" class="btn btn-flat btn-sm edit-mode-toggle" data-action="toggleEdit" aria-label="Edit placement (E)" title="Edit placement (E)" hidden>Edit</button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="time" data-view-only aria-label="Time (V)" title="Time (V)">
      ${ICONS.time}
    </button>
  `;

  // Edit/view actions — vertical strip on the right edge of the viewport.
  const side = document.createElement("div");
  side.id = "transformToolbarSide";
  side.className = "transform-toolbar transform-toolbar-side";
  side.setAttribute("role", "toolbar");
  side.setAttribute("aria-label", "Edit and view actions");
  side.innerHTML = `
    <button id="undoBtn" class="btn btn-flat btn-sm" data-action="undo" aria-label="Undo" title="Nothing to undo" disabled>
      ${ICONS.undo}
    </button>
    <button id="redoBtn" class="btn btn-flat btn-sm" data-action="redo" aria-label="Redo" title="Nothing to redo" disabled>
      ${ICONS.redo}
    </button>
    <button id="gridToggleBtn" class="btn btn-flat btn-sm active" data-action="toggleGrid" aria-label="Toggle grid and axes" title="Toggle grid and axes" aria-pressed="true">
      ${ICONS.grid}
    </button>
  `;

  viewport.appendChild(toolbar);
  viewport.appendChild(side);

  const onToolbarClick = (e: MouseEvent) => {
    const actionBtn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    const action = actionBtn ? ACTIONS[actionBtn.dataset.action || ""] : undefined;
    if (action) {
      action();
      return;
    }
    const btn = (e.target as HTMLElement).closest(".transform-tool") as HTMLElement | null;
    if (btn?.dataset.mode) setMode(btn.dataset.mode as TransformMode);
  };
  toolbar.addEventListener("click", onToolbarClick);
  side.addEventListener("click", onToolbarClick);
}

function wireEvents(gizmoManager: BABYLON.GizmoManager): void {
  on(EVENTS.NODE_SELECTED, () => {
    if (isEditing() && !_isPlacementMode(state.transformMode)) setMode("translate");
    else _refreshAttachment(gizmoManager);
  });

  on(EVENTS.SELECTION_CHANGED, () => {
    // Time mode is single-selection only.
    if (state.transformMode === "time" && state.selectedNodeIds.size > 1) _clearMode();
    else _refreshAttachment(gizmoManager);
  });

  on(EVENTS.NODE_DESELECTED, () => {
    gizmoManager.attachToNode(null);
    disposeGroupPivot();
    updateToolbarUI();
  });

  on(EVENTS.SCENE_CLEARED, () => {
    gizmoManager.attachToNode(null);
    disposeGroupPivot();
    // Do not reset transformMode here: clearing the scene is part of version
    // navigation (loadVersion -> clearScene -> loadAssetManifest), and the user
    // should remain in Time mode so the model clock can rebuild on SCENE_READY.
    // (edit-mode.ts drops Edit on SCENE_CLEARED; _onEditModeChanged clears a
    // placement mode.)
    updateToolbarUI();
  });

  subscribeEditMode(_onEditModeChanged);
}

function _isEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return (
    !!el?.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button"
  );
}

/** V: time travel works in View and Edit; from Edit it leaves Edit first. */
function _enterTime(): void {
  if (state.selectedNodeIds.size > 1) return; // refused before leaving Edit
  if (isEditing()) setEditing(false);
  setMode("time");
}

const KEYS_ANY: Record<string, () => void> = {
  e: () => {
    toggleEditing();
  },
  v: _enterTime,
};

const KEYS_EDIT: Record<string, () => void> = {
  t: () => setMode("translate"),
  r: () => setMode("rotate"),
  g: dropSelectionToFloor,
};

const KEYS_EDIT_SHIFT: Record<string, () => void> = {
  r: resetSelectionTransform,
};

function _keyAction(e: KeyboardEvent): (() => void) | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  if (e.shiftKey) return isEditing() ? KEYS_EDIT_SHIFT[key] : undefined;
  return KEYS_ANY[key] ?? (isEditing() ? KEYS_EDIT[key] : undefined);
}

let _keyboardWired = false;

function wireKeyboard(): void {
  // Document-level listeners: wire once per page, even if init re-runs.
  if (_keyboardWired) return;
  _keyboardWired = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Alt") _setAltHeld(true);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Alt") _setAltHeld(false);
  });
  // A modifier released outside the window must not leave snapping off.
  window.addEventListener("blur", () => _setAltHeld(false));
  document.addEventListener("keydown", (e) => {
    if (e.repeat || _isEditableFocus()) return;
    const action = _keyAction(e);
    if (!action) return;
    e.preventDefault();
    action();
  });
}

function _isPlacementMode(mode: TransformMode): boolean {
  return mode === "translate" || mode === "rotate";
}

/** Gizmo off, nothing attached, no mode — the View-mode resting state. */
function _clearMode(): void {
  const gm = state.gizmoManager;
  if (!gm) return;
  state.transformMode = null;
  gm.positionGizmoEnabled = false;
  gm.rotationGizmoEnabled = false;
  gm.attachToNode(null);
  disposeGroupPivot();
  updateToolbarUI();
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode: null });
}

/** Set while Edit was left mid-drag; the drag-end handler finishes the exit. */
let _detachAfterDrag = false;

function _onEditModeChanged(): void {
  if (isEditing()) {
    if (_isPlacementMode(state.transformMode)) updateToolbarUI();
    else setMode("translate");
    return;
  }
  if (!_isPlacementMode(state.transformMode)) {
    updateToolbarUI();
    return;
  }
  if (state.isGizmoDragging) {
    _detachAfterDrag = true;
    updateToolbarUI();
    return;
  }
  _clearMode();
}

/** Re-attach after a selection change — only placement and time modes attach. */
function _refreshAttachment(gm: BABYLON.GizmoManager): void {
  if (isEditing() || state.transformMode === "time") attachToSelected(gm);
  else gm.attachToNode(null);
  updateToolbarUI();
}

/**
 * Switch the active transform mode.
 */
function setMode(mode: TransformMode): void {
  if (!state.gizmoManager) return;
  // An explicit mode choice supersedes a deferred mid-drag Edit exit.
  _detachAfterDrag = false;
  // Placement tools exist only in Edit mode.
  if (_isPlacementMode(mode) && !isEditing()) return;
  // Per-node time-travel is a single-selection feature.
  if (mode === "time" && state.selectedNodeIds.size > 1) {
    console.log("[GIZMO] time mode ignored: multi-selection active");
    return;
  }

  state.transformMode = mode;
  state.gizmoManager.positionGizmoEnabled = mode === "translate";
  state.gizmoManager.rotationGizmoEnabled = mode === "rotate";

  // Gizmos are created lazily; subscribe to drag-end on whichever exists.
  const gizmos = state.gizmoManager.gizmos || {};
  ensureDragEndSubscription(gizmos.positionGizmo);
  ensureDragEndSubscription(gizmos.rotationGizmo);
  _applyGizmoConstraints();

  attachToSelected(state.gizmoManager);
  updateToolbarUI();
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode });
}

const _subscribedGizmos = new WeakSet<object>();

/**
 * @param gizmo a Babylon position/rotation gizmo.
 */
function ensureDragEndSubscription(gizmo: any): void {
  if (!gizmo || _subscribedGizmos.has(gizmo)) return;
  let subscribed = false;
  if (gizmo.onDragStartObservable) {
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
      _dragBefore = snapshotMatrices(selectedIds());
      _dragMode = state.transformMode;
      _applyGizmoConstraints(); // grid may have rescaled since the last drag
      // Floor-locked Move starts grounded (fixes floating legacy assets);
      // the correction rides in this drag's undo entry.
      if (_floorLocked && _dragMode === "translate") {
        shiftGroupPivotY(groundAnchors(_selectionAnchors()));
      }
      if (state.selectedNodeIds.size > 1) startGroupDrag();
    });
    subscribed = true;
  }
  if (gizmo.onDragEndObservable) {
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      endGroupDrag();
      // Rotating a long part tips it through the floor — re-ground it.
      if (_floorLocked && _dragMode === "rotate") {
        shiftGroupPivotY(groundAnchors(_selectionAnchors()));
      }
      _setAltHeld(false);
      commitTransformChange(_MODE_LABELS[_dragMode || ""] || "Transform", _dragBefore);
      _dragBefore = null;
      _dragMode = null;
      if (_detachAfterDrag) {
        _detachAfterDrag = false;
        if (!isEditing() && _isPlacementMode(state.transformMode)) _clearMode();
      }
    });
    subscribed = true;
  }
  if (subscribed) _subscribedGizmos.add(gizmo);
}

function attachToSelected(gizmoManager: BABYLON.GizmoManager): void {
  if (state.selectedNodeIds.size > 1) {
    attachToGroupPivot(gizmoManager);
    return;
  }

  const nodeId = state.highlightedNodeId;
  if (!nodeId) {
    gizmoManager.attachToNode(null);
    return;
  }

  const anchor = state.nodeAnchors.get(nodeId);
  if (anchor && !anchor.isDisposed()) {
    gizmoManager.attachToNode(anchor);
  } else {
    gizmoManager.attachToNode(null);
  }
}

function _renderEditButton(editing: boolean): void {
  const btn = document.getElementById("editModeBtn");
  if (!btn) return;
  btn.hidden = !canEdit();
  btn.textContent = editing ? "Done" : "Edit";
  const label = editing ? "Done editing (E)" : "Edit placement (E)";
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function _renderToolButton(
  btn: HTMLButtonElement,
  activeMode: TransformMode,
  hasSelection: boolean,
  isMulti: boolean
): void {
  const isActive = btn.dataset.mode === activeMode;
  btn.classList.toggle("active", isActive);
  btn.setAttribute("aria-pressed", String(isActive));
  const isTime = btn.dataset.mode === "time";
  btn.disabled = !hasSelection || (isTime && isMulti);
  if (isTime) {
    btn.title = isMulti ? "Time travel is available for a single selected node" : "Time (V)";
  }
}

function _renderPlacementButtons(toolbar: HTMLElement, hasSelection: boolean): void {
  for (const btn of toolbar.querySelectorAll<HTMLButtonElement>(".placement-action")) {
    btn.disabled = !hasSelection;
  }
  const lock = document.getElementById("lockFloorBtn");
  if (lock) {
    lock.classList.toggle("active", _floorLocked);
    lock.setAttribute("aria-pressed", String(_floorLocked));
  }
}

function updateToolbarUI(): void {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;
  const editing = isEditing();
  const hasSelection = state.selectedNodeIds.size > 0 || !!state.highlightedNodeId;
  const isMulti = state.selectedNodeIds.size > 1;
  const activeMode = hasSelection ? state.transformMode : null;

  for (const el of toolbar.querySelectorAll<HTMLElement>("[data-edit-only]")) el.hidden = !editing;
  for (const el of toolbar.querySelectorAll<HTMLElement>("[data-view-only]")) el.hidden = editing;
  _renderEditButton(editing);
  for (const btn of toolbar.querySelectorAll<HTMLButtonElement>(".transform-tool")) {
    _renderToolButton(btn, activeMode, hasSelection, isMulti);
  }
  _renderPlacementButtons(toolbar, hasSelection);
}

export { initTransformGizmo };
