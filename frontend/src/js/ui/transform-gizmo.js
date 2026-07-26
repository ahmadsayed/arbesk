// @ts-nocheck
/**
 * Arbesk Transform Gizmo
 *
 * Viewport controls to translate, rotate, and scale the currently selected
 * node using Babylon.js's built-in GizmoManager. Transform edits are staged
 * in `state.pendingTransformEdits` and persisted to the manifest on the
 * next Save Draft / Publish.
 */

import { on, emit, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";
import {
  stageNodeTransform,
  readNodeTransformMatrix,
} from "../engine/transforms.js";
import { undo, redo } from "../engine/undo-controller.js";
import { pushUndoEntry } from "../engine/undo-stack.js";

const TOOLBAR_ID = "transformToolbar";

const ICONS = {
  translate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l4-4 4 4"/><path d="M9 5v14"/><path d="M19 15l-4 4-4-4"/><path d="M15 19V5"/></svg>',
  rotate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 11a9 9 0 0 1 15.2-5.8L21.5 8"/><path d="M21.5 13a9 9 0 0 1-15.2 5.8L2.5 16"/></svg>',
  scale:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 9 15"/><path d="M12 3H3v18h18v-9"/><path d="M16 3h5v5"/><path d="M14 15l7 7"/></svg>',
  time:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  undo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  redo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
};

/**
 * Initialize the transform gizmo and its viewport toolbar.
 * Called once from scene-graph.js after the engine and scene are ready.
 *
 * @param {BABYLON.Scene} scene
 * @param {BABYLON.ArcRotateCamera} _camera
 */
function initTransformGizmo(scene, _camera) {
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
  gizmoManager.scaleGizmoEnabled = false;
  gizmoManager.usePointerToAttachGizmos = false;
  gizmoManager.clearGizmoOnEmptyPointerEvent = false;

  // Planar drag is more useful than single-axis drag for most assets.
  if (gizmoManager.gizmos?.positionGizmo) {
    gizmoManager.gizmos.positionGizmo.planarGizmoEnabled = true;
  }

  state.gizmoManager = gizmoManager;
  state.transformMode = null;

  // Per-frame fan-out for group drags: the gizmo mutates the pivot; each
  // selected anchor follows via its drag-start relative matrix.
  scene.onBeforeRenderObservable?.add(() => {
    if (state.isGizmoDragging && _groupSnapshot) _applyGroupDrag();
  });

  createToolbar();
  wireEvents(gizmoManager);
  wireKeyboard(gizmoManager);
  updateToolbarUI();

  console.log("[GIZMO] transform gizmo initialized");
}

/**
 * Read the current local transform of one anchor and stage it for
 * persistence in the manifest.
 */
function captureNodeTransform(nodeId) {
  if (stageNodeTransform(nodeId)) {
    console.log(`[GIZMO] transform staged | nodeId=${nodeId}`);
  }
}

/**
 * Node ids the gizmo acts on: the multi-selection when present, otherwise the
 * single highlighted node.
 */
function _selectedIds() {
  return state.selectedNodeIds.size > 0
    ? [...state.selectedNodeIds]
    : state.highlightedNodeId
      ? [state.highlightedNodeId]
      : [];
}

/**
 * Stage the transforms of every selected node (single or multi-selection)
 * and notify listeners (e.g. the inspector scale fields) so they can
 * refresh from the anchors.
 */
function captureSelectedTransform() {
  const ids = _selectedIds();
  for (const nodeId of ids) captureNodeTransform(nodeId);
  if (ids.length > 0) emit(EVENTS.TRANSFORM_STAGED, { nodeIds: ids });
}

// ── Undo capture ──
// Snapshot the selected anchors' matrices at drag start; at drag end push one
// undo entry per drag gesture covering every node that actually moved.

const _MODE_LABELS = { translate: "Move", rotate: "Rotate", scale: "Scale" };

/** @type {Array<{nodeId: string, matrix: number[]}>|null} */
let _dragBefore = null;

function _snapshotSelectedMatrices() {
  const out = [];
  for (const nodeId of _selectedIds()) {
    const matrix = readNodeTransformMatrix(nodeId);
    if (matrix) out.push({ nodeId, matrix });
  }
  return out;
}

function _matricesEqual(a, b, eps = 1e-6) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

function _pushDragUndoEntry() {
  const before = _dragBefore;
  _dragBefore = null;
  if (!before || before.length === 0) return;
  const items = [];
  for (const { nodeId, matrix } of before) {
    const after = readNodeTransformMatrix(nodeId);
    if (after && !_matricesEqual(matrix, after)) {
      items.push({ nodeId, before: matrix, after });
    }
  }
  if (items.length === 0) return; // click without drag
  pushUndoEntry({
    type: "transform",
    label: _MODE_LABELS[state.transformMode] || "Transform",
    items,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Group pivot — multi-selection transforms
//
// With 2+ nodes selected the gizmo attaches to a synthetic pivot TransformNode
// at the selection centroid instead of a node anchor. On drag start we
// snapshot each anchor's world matrix relative to the pivot; every frame the
// gizmo moves the pivot we re-derive each anchor's local TRS from the new
// pivot world matrix, so the whole group moves/rotates/scales around the
// shared centroid (Blender "median point" style).
// ═══════════════════════════════════════════════════════════════════════════

/** @type {BABYLON.TransformNode|null} */
let _groupPivot = null;
/**
 * Per-drag snapshot: relative world matrices + parent-space inverses for each
 * selected anchor. Null outside an active group drag.
 * @type {Array<{anchor: BABYLON.TransformNode, rel: BABYLON.Matrix, parentInv: BABYLON.Matrix}>|null}
 */
let _groupSnapshot = null;

function _disposeGroupPivot() {
  _groupSnapshot = null;
  if (_groupPivot && !_groupPivot.isDisposed()) {
    _groupPivot.dispose();
  }
  _groupPivot = null;
}

function _ensureGroupPivot() {
  if (_groupPivot && !_groupPivot.isDisposed()) return _groupPivot;
  _groupPivot = new BABYLON.TransformNode("groupTransformPivot", state.scene);
  _groupPivot.rotationQuaternion = BABYLON.Quaternion.Identity();
  return _groupPivot;
}

/**
 * Selected anchors whose Babylon parent chain contains no other selected
 * anchor. Ctrl+A selects child-world-internal anchors too; transforming both
 * a parent and its nested child in the same group drag would move the child
 * twice (once via the parent hierarchy, once directly), so only the top-most
 * anchors are driven — nested ones ride along.
 * @returns {BABYLON.TransformNode[]}
 */
function _topLevelSelectedAnchors() {
  const anchors = [...state.selectedNodeIds]
    .map((id) => state.nodeAnchors.get(id))
    .filter((a) => a && !a.isDisposed());
  const set = new Set(anchors);
  return anchors.filter((a) => {
    for (let p = a.parent; p; p = p.parent) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/**
 * Place the pivot at the centroid of the selected anchors' world positions
 * with identity rotation/scale, and attach the gizmo to it.
 */
function _attachToGroupPivot(gizmoManager) {
  const anchors = _topLevelSelectedAnchors();
  if (anchors.length === 0) {
    gizmoManager.attachToNode(null);
    return;
  }
  // Selection collapses to a single subtree (e.g. a model plus its own
  // child-world node): drive that anchor directly, no pivot needed.
  if (anchors.length === 1) {
    gizmoManager.attachToNode(anchors[0]);
    return;
  }

  const pivot = _ensureGroupPivot();
  const centroid = anchors
    .reduce((sum, a) => sum.addInPlace(a.getAbsolutePosition()), BABYLON.Vector3.Zero())
    .scaleInPlace(1 / anchors.length);
  pivot.position.copyFrom(centroid);
  pivot.rotationQuaternion.copyFrom(BABYLON.Quaternion.Identity());
  pivot.scaling.copyFromFloats(1, 1, 1);
  pivot.computeWorldMatrix(true);

  gizmoManager.attachToNode(pivot);
}

function _startGroupDrag() {
  if (!_groupPivot || state.selectedNodeIds.size < 2) return;
  const topAnchors = _topLevelSelectedAnchors();
  if (topAnchors.length < 2) return; // gizmo is on the single anchor directly
  _groupPivot.computeWorldMatrix(true);
  const pivotInv = BABYLON.Matrix.Invert(_groupPivot.getWorldMatrix());
  _groupSnapshot = [];
  for (const anchor of topAnchors) {
    anchor.computeWorldMatrix(true);
    // Babylon row-vector convention: A.multiply(B) applies A first, so the
    // anchor-in-pivot-space matrix is anchorWorld × pivotInv — not the reverse.
    // The reversed order makes the pivot's offset pre-multiply the anchor's
    // own scale/rotation (scaled anchors move faster/slower than the gizmo).
    const rel = anchor.getWorldMatrix().multiply(pivotInv);
    const parentWorld = anchor.parent
      ? anchor.parent.getWorldMatrix()
      : BABYLON.Matrix.Identity();
    _groupSnapshot.push({
      anchor,
      rel,
      parentInv: BABYLON.Matrix.Invert(parentWorld),
    });
  }
}

/**
 * Re-derive every grouped anchor's local TRS from the pivot's current world
 * matrix. Called per frame while a group drag is active.
 */
function _applyGroupDrag() {
  if (!_groupSnapshot || !_groupPivot) return;
  _groupPivot.computeWorldMatrix(true);
  const pivotWorld = _groupPivot.getWorldMatrix();
  const scale = new BABYLON.Vector3();
  const rotation = new BABYLON.Quaternion();
  const position = new BABYLON.Vector3();
  for (const entry of _groupSnapshot) {
    if (entry.anchor.isDisposed()) continue;
    // rel × pivotWorld (apply rel first, then the pivot's new world matrix)
    // — the matching order to the drag-start snapshot above.
    const world = entry.rel.multiply(pivotWorld);
    const local = world.multiply(entry.parentInv);
    if (!local.decompose(scale, rotation, position)) continue;
    entry.anchor.scaling.copyFrom(scale);
    entry.anchor.rotationQuaternion = entry.anchor.rotationQuaternion || new BABYLON.Quaternion();
    entry.anchor.rotationQuaternion.copyFrom(rotation);
    entry.anchor.position.copyFrom(position);
  }
}

function _endGroupDrag() {
  _groupSnapshot = null;
}

function createToolbar() {
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  if (document.getElementById(TOOLBAR_ID)) return;

  const toolbar = document.createElement("div");
  toolbar.id = TOOLBAR_ID;
  toolbar.className = "transform-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Transform tools");

  toolbar.innerHTML = `
    <button id="undoBtn" class="btn btn-flat btn-sm" data-action="undo" aria-label="Undo" title="Nothing to undo" disabled>
      ${ICONS.undo}
    </button>
    <button id="redoBtn" class="btn btn-flat btn-sm" data-action="redo" aria-label="Redo" title="Nothing to redo" disabled>
      ${ICONS.redo}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="translate" aria-label="Move (T)" title="Move (T)">
      ${ICONS.translate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="rotate" aria-label="Rotate (R)" title="Rotate (R)">
      ${ICONS.rotate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="scale" aria-label="Scale (S)" title="Scale (S)">
      ${ICONS.scale}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="time" aria-label="Time (V)" title="Time (V)">
      ${ICONS.time}
    </button>
  `;

  viewport.appendChild(toolbar);

  toolbar.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      if (actionBtn.dataset.action === "undo") undo();
      else redo();
      return;
    }
    const btn = e.target.closest(".transform-tool");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (!mode) return;
    setMode(mode);
  });
}

function wireEvents(gizmoManager) {
  on(EVENTS.NODE_SELECTED, () => {
    if (!state.transformMode) {
      setMode("translate");
    } else {
      attachToSelected(gizmoManager);
      updateToolbarUI();
    }
  });

  on(EVENTS.SELECTION_CHANGED, () => {
    // Time mode is single-selection only: fall back to translate when the
    // selection grows past one node.
    if (state.transformMode === "time" && state.selectedNodeIds.size > 1) {
      setMode("translate");
    } else {
      attachToSelected(gizmoManager);
      updateToolbarUI();
    }
  });

  on(EVENTS.NODE_DESELECTED, () => {
    gizmoManager.attachToNode(null);
    _disposeGroupPivot();
    updateToolbarUI();
  });

  on(EVENTS.SCENE_CLEARED, () => {
    gizmoManager.attachToNode(null);
    _disposeGroupPivot();
    // Do not reset transformMode here: clearing the scene is part of version
    // navigation (loadVersion -> clearScene -> loadAssetManifest), and the user
    // should remain in Time mode so the model clock can rebuild on SCENE_READY.
    updateToolbarUI();
  });
}

function wireKeyboard(_gizmoManager) {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable =
      document.activeElement?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "button";
    if (editable) return;

    switch (e.key.toLowerCase()) {
      case "t":
        e.preventDefault();
        setMode("translate");
        break;
      case "r":
        e.preventDefault();
        setMode("rotate");
        break;
      case "s":
        e.preventDefault();
        setMode("scale");
        break;
      case "v":
        e.preventDefault();
        setMode("time");
        break;
    }
  });
}

/**
 * Switch the active transform mode.
 *
 * @param {'translate' | 'rotate' | 'scale' | 'time'} mode
 */
function setMode(mode) {
  if (!state.gizmoManager) return;

  // Per-node time-travel is a single-selection feature.
  if (mode === "time" && state.selectedNodeIds.size > 1) {
    console.log("[GIZMO] time mode ignored: multi-selection active");
    return;
  }

  // Toggling the same mode off is not implemented; users can press Esc to
  // deselect or click empty space to hide the gizmo.
  state.transformMode = mode;
  state.gizmoManager.positionGizmoEnabled = mode === "translate";
  state.gizmoManager.rotationGizmoEnabled = mode === "rotate";
  state.gizmoManager.scaleGizmoEnabled = mode === "scale";

  // Gizmos are created lazily; subscribe to drag-end on whichever exists.
  const gizmos = state.gizmoManager.gizmos || {};
  ensureDragEndSubscription(gizmos.positionGizmo);
  ensureDragEndSubscription(gizmos.rotationGizmo);
  ensureDragEndSubscription(gizmos.scaleGizmo);

  attachToSelected(state.gizmoManager);
  updateToolbarUI();
  emit(EVENTS.TRANSFORM_MODE_CHANGED, { mode });
}

const _subscribedGizmos = new WeakSet();

function ensureDragEndSubscription(gizmo) {
  if (!gizmo || _subscribedGizmos.has(gizmo)) return;
  let subscribed = false;
  if (gizmo.onDragStartObservable) {
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
      _dragBefore = _snapshotSelectedMatrices();
      if (state.selectedNodeIds.size > 1) _startGroupDrag();
    });
    subscribed = true;
  }
  if (gizmo.onDragEndObservable) {
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      _endGroupDrag();
      captureSelectedTransform();
      _pushDragUndoEntry();
    });
    subscribed = true;
  }
  if (subscribed) _subscribedGizmos.add(gizmo);
}

function attachToSelected(gizmoManager) {
  if (state.selectedNodeIds.size > 1) {
    _attachToGroupPivot(gizmoManager);
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

function updateToolbarUI() {
  const toolbar = document.getElementById(TOOLBAR_ID);
  if (!toolbar) return;

  const hasSelection =
    state.selectedNodeIds.size > 0 || !!state.highlightedNodeId;
  const isMulti = state.selectedNodeIds.size > 1;
  const activeMode = hasSelection ? state.transformMode : null;

  for (const btn of toolbar.querySelectorAll(".transform-tool")) {
    const isActive = btn.dataset.mode === activeMode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    const isTime = btn.dataset.mode === "time";
    btn.disabled = !hasSelection || (isTime && isMulti);
    if (isTime) {
      btn.title = isMulti
        ? "Time travel is available for a single selected node"
        : "Time (V)";
    }
  }
}

export { initTransformGizmo };
