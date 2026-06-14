/**
 * Arbesk Transform Gizmo
 *
 * Viewport controls to translate, rotate, and scale the currently selected
 * node using Babylon.js's built-in GizmoManager. Transform edits are staged
 * in `state.pendingTransformEdits` and persisted to the manifest on the
 * next Save Draft / Publish.
 */

import { emit, on, EVENTS } from "../events/registry.js";
import { state } from "../engine/state.js";

const TOOLBAR_ID = "transformToolbar";

const ICONS = {
  translate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 9l4-4 4 4"/><path d="M9 5v14"/><path d="M19 15l-4 4-4-4"/><path d="M15 19V5"/></svg>',
  rotate:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M2.5 11a9 9 0 0 1 15.2-5.8L21.5 8"/><path d="M21.5 13a9 9 0 0 1-15.2 5.8L2.5 16"/></svg>',
  scale:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 9 15"/><path d="M12 3H3v18h18v-9"/><path d="M16 3h5v5"/><path d="M14 15l7 7"/></svg>',
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

  createToolbar();
  wireEvents(gizmoManager);
  wireKeyboard(gizmoManager);
  updateToolbarUI();

  console.log("[GIZMO] transform gizmo initialized");
}

/**
 * Return a copy of the Babylon Matrix's `.m` array. Babylon stores matrices
 * column-major, which matches the glTF / Arbesk manifest `transform_matrix`
 * format consumed by `applyTransformMatrix()`.
 */
function matrixToManifestArray(matrix) {
  return Array.from(matrix.m);
}

/**
 * Read the selected anchor's current local transform and stage it for
 * persistence in the manifest.
 */
function captureSelectedTransform() {
  const nodeId = state.highlightedNodeId;
  if (!nodeId) return;

  const anchor = state.nodeAnchors.get(nodeId);
  if (!anchor || anchor.isDisposed()) return;

  const rotation =
    anchor.rotationQuaternion || BABYLON.Quaternion.Identity();
  const matrix = BABYLON.Matrix.Compose(
    anchor.scaling,
    rotation,
    anchor.position
  );
  const matrixArray = matrixToManifestArray(matrix);

  state.pendingTransformEdits.set(nodeId, matrixArray);
  console.log(`[GIZMO] transform staged | nodeId=${nodeId}`);
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
    <button class="btn btn-flat btn-sm transform-tool" data-mode="translate" aria-label="Move (T)" title="Move (T)">
      ${ICONS.translate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="rotate" aria-label="Rotate (R)" title="Rotate (R)">
      ${ICONS.rotate}
    </button>
    <button class="btn btn-flat btn-sm transform-tool" data-mode="scale" aria-label="Scale (S)" title="Scale (S)">
      ${ICONS.scale}
    </button>
  `;

  viewport.appendChild(toolbar);

  toolbar.addEventListener("click", (e) => {
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
    }
  });

  on(EVENTS.NODE_DESELECTED, () => {
    gizmoManager.attachToNode(null);
    updateToolbarUI();
  });

  on(EVENTS.SCENE_CLEARED, () => {
    gizmoManager.attachToNode(null);
    state.transformMode = null;
    updateToolbarUI();
  });
}

function wireKeyboard(gizmoManager) {
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
    }
  });
}

/**
 * Switch the active transform mode.
 *
 * @param {'translate' | 'rotate' | 'scale'} mode
 */
function setMode(mode) {
  if (!state.gizmoManager) return;

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
}

const _subscribedGizmos = new WeakSet();

function ensureDragEndSubscription(gizmo) {
  if (!gizmo || _subscribedGizmos.has(gizmo)) return;
  if (gizmo.onDragEndObservable) {
    gizmo.onDragEndObservable.add(() => captureSelectedTransform());
    _subscribedGizmos.add(gizmo);
  }
}

function attachToSelected(gizmoManager) {
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

  const hasSelection = !!state.highlightedNodeId;
  const activeMode = hasSelection ? state.transformMode : null;

  for (const btn of toolbar.querySelectorAll(".transform-tool")) {
    const isActive = btn.dataset.mode === activeMode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    btn.disabled = !hasSelection;
  }
}

export { initTransformGizmo };
