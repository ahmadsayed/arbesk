/**
 * Arbesk Parametric Preview & Token Child Inspector
 *
 * Binds Node Inspector inputs to live Babylon.js material/mesh updates.
 * Color edits are applied directly to the source glTF/GLB asset on Save;
 * the inspector only keeps a lightweight pending-edit map for the live
 * preview so the viewport stays responsive.
 *
 * Closing the inspector (X) reverts the live preview to the material colors
 * captured when the inspector opened.
 */

import { emit, on, EVENTS } from "../events/bus.js";
import { applyColor } from "./time-travel.js";
import { stageNodeTransform, readNodeTransformMatrix, matricesEqual } from "./transforms.js";
import { pushUndoEntry } from "./undo-stack.js";
import { registerUndoApplier } from "./undo-controller.js";
import {
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  deselectAll,
  selectNodeById,
  selectSubMesh,
  state,
} from "./scene-graph.js";

// DOM references
const inspector = document.getElementById("inspector");
const inspectorToggle = document.getElementById("inspectorToggle");
const inspectorReveal = document.getElementById("inspectorReveal");
const parametricEditor = document.getElementById("parametricEditor");
const tokenChildInfo = document.getElementById("tokenChildInfo");
const tokenChildInfoDetails = tokenChildInfo?.querySelector("details");
const parametricEditorDetails = parametricEditor?.querySelector("details");
const nodeColorInput = document.getElementById("nodeColor");

const scaleSection = document.getElementById("scaleSection");
/** @type {HTMLInputElement|null} */
const nodeScaleFactor = /** @type {HTMLInputElement|null} */ (document.getElementById("nodeScaleFactor"));
/** @type {HTMLInputElement|null} */
const nodeScalePercent = /** @type {HTMLInputElement|null} */ (document.getElementById("nodeScalePercent"));
const componentEditor = document.getElementById("componentEditor");
const selectedComponentName = document.getElementById("selectedComponentName");
const selectedComponentSwatch = document.getElementById(
  "selectedComponentSwatch"
);
/** @type {HTMLInputElement|null} */
const selectedComponentColor = /** @type {HTMLInputElement|null} */ (
  document.getElementById("selectedComponentColor")
);

// Token child info elements
const tokenChildIdEl = document.getElementById("tokenChildId");
const tokenChildContractEl = document.getElementById("tokenChildContract");
const tokenChildChainEl = document.getElementById("tokenChildChain");
const tokenChildResolutionEl = document.getElementById("tokenChildResolution");
const tokenChildCidEl = document.getElementById("tokenChildCid");

// State
/** @type {string|null} */
let activeNodeId = null;
/** @type {string|null} */
let activeMeshName = null;
// Original material colors captured at inspector open, used to revert on close.
/** @type {Record<string, string>} */
let originalMaterialColors = {};
// Pending direct source color edits: Map<nodeId, Map<meshName, hexColor>>
const pendingSourceColorEdits = new Map();

// ── Undo / Redo ──────────────────────────────────────────────────────────────
// Color and inspector-scale edits push snapshot entries into the shared scene
// undo stack (engine/undo-stack.js); engine/undo-controller.js applies them
// through the applier registered below and owns the Ctrl+Z dispatcher.

/** @type {string|null} */
let _colorBeforeEdit = null;

// Applies one color entry item from the shared undo stack: restores the mesh
// color, syncs the inspector UI when it shows this node/mesh, and keeps
// pendingSourceColorEdits aligned so Save writes the undone/redone color.
registerUndoApplier("color", (item, direction) => {
  const color = direction === "before" ? item.before : item.after;
  // Color entries always carry a meshName (optional only for transforms).
  const meshName = /** @type {string} */ (item.meshName);
  const meshes = getNodeMeshes(item.nodeId);
  if (meshes) applyColor(meshes, null, { [meshName]: { color } });

  if (activeNodeId === item.nodeId && activeMeshName === meshName) {
    if (selectedComponentColor) selectedComponentColor.value = color;
    if (selectedComponentSwatch)
      selectedComponentSwatch.style.backgroundColor = color;
  }

  let nodeEdits = pendingSourceColorEdits.get(item.nodeId);
  if (!nodeEdits) {
    nodeEdits = new Map();
    pendingSourceColorEdits.set(item.nodeId, nodeEdits);
  }
  nodeEdits.set(meshName, color);
});

/**
 * Read the current solid color from a mesh's material (diffuse or albedo).
 *
 * @param {BABYLON.AbstractMesh} mesh
 * @returns {string|null}
 */
function getMeshMaterialColor(mesh) {
  if (!mesh?.material) return null;
  const mat = mesh.material;
  if (mat.diffuseColor) return mat.diffuseColor.toHexString();
  if (mat.albedoColor) return mat.albedoColor.toHexString();
  if (mat.getSubMeshMaterials) {
    for (const sub of mat.getSubMeshMaterials()) {
      if (sub?.diffuseColor) return sub.diffuseColor.toHexString();
      if (sub?.albedoColor) return sub.albedoColor.toHexString();
    }
  }
  return null;
}

// ── Uniform scale fields ─────────────────────────────────────────────────────

const MIN_SCALE = 0.01;

/**
 * @param {string|null} nodeId
 * @returns {BABYLON.TransformNode|null}
 */
function _getLiveAnchor(nodeId) {
  if (!nodeId) return null;
  const anchor = state.nodeAnchors.get(nodeId);
  return anchor && !anchor.isDisposed() ? anchor : null;
}

/**
 * Sync the Scale section fields from the active node's anchor. Hides the
 * section when no single selected node has a live anchor, and skips the
 * refresh while a scale field has focus so typing is never clobbered.
 */
function _refreshScaleFields() {
  if (!scaleSection || !nodeScaleFactor || !nodeScalePercent) return;
  const anchor = _getLiveAnchor(activeNodeId);
  if (!anchor) {
    scaleSection.hidden = true;
    return;
  }
  scaleSection.hidden = false;
  const focused = document.activeElement;
  if (focused === nodeScaleFactor || focused === nodeScalePercent) return;
  const factor = anchor.scaling.x;
  nodeScaleFactor.value = String(Math.round(factor * 1000) / 1000);
  nodeScalePercent.value = String(Math.round(factor * 100));
}

/**
 * Apply an absolute uniform scale factor to the active node and stage the
 * transform for Save/Publish — the same path as the viewport scale gizmo.
 * Keying the same factor into every copy of a model makes them identical
 * in size.
 *
 * @param {number} factor
 */
function _applyUniformScale(factor) {
  const anchor = _getLiveAnchor(activeNodeId);
  if (!anchor || !Number.isFinite(factor) || factor < MIN_SCALE) {
    _refreshScaleFields();
    return;
  }
  const before = activeNodeId ? readNodeTransformMatrix(activeNodeId) : null;
  anchor.scaling.setAll(factor);
  if (activeNodeId) {
    stageNodeTransform(activeNodeId);
    const after = readNodeTransformMatrix(activeNodeId);
    if (before && after && !matricesEqual(before, after)) {
      pushUndoEntry({
        type: "transform",
        label: "Scale",
        items: [{ nodeId: activeNodeId, before, after }],
      });
    }
  }
  _refreshScaleFields();
}

/**
 * Show the Token Child Info panel for a child_ref node.
 *
 * @param {string} nodeId
 */
function showTokenChildInfo(nodeId) {
  if (parametricEditor) parametricEditor.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = false;
  if (tokenChildInfoDetails) tokenChildInfoDetails.open = true;
  if (componentEditor) componentEditor.hidden = true;
  _refreshScaleFields();

  const childRef = getNodeChildRef(nodeId);
  // Support both legacy {tokenId, chainId, contractAddress, resolution} and
  // collection {collection: {chainId, contractAddress, tokenId}, assetID} formats.
  const refTokenId = childRef?.tokenId || childRef?.collection?.tokenId || null;
  const refChainId = childRef?.chainId || childRef?.collection?.chainId || null;
  const refContractAddress =
    childRef?.contractAddress || childRef?.collection?.contractAddress || null;

  if (childRef && tokenChildIdEl) {
    tokenChildIdEl.textContent = refTokenId ? `Token #${refTokenId}` : "—";
  }
  if (tokenChildContractEl) {
    tokenChildContractEl.textContent = refContractAddress
      ? `${refContractAddress.slice(0, 10)}…${refContractAddress.slice(-6)}`
      : "—";
  }
  if (tokenChildChainEl) tokenChildChainEl.textContent = refChainId || "—";
  if (tokenChildResolutionEl)
    tokenChildResolutionEl.textContent = childRef?.resolution || "latest";
  if (tokenChildCidEl)
    tokenChildCidEl.textContent = childRef?.resolvedCid || "—";

  if (inspector) inspector.classList.remove("collapsed");
}

/**
 * Collapse the inspector panel without changing the current selection or
 * reverting the live preview.
 */
function collapseInspector() {
  if (inspector) inspector.classList.add("collapsed");
  syncInspectorToggleAria();
}

/**
 * Expand the inspector panel.
 */
function expandInspector() {
  if (inspector) inspector.classList.remove("collapsed");
  syncInspectorToggleAria();
}

/**
 * Toggle the inspector panel open/closed.
 */
function toggleInspector() {
  if (inspector && inspector.classList.contains("collapsed")) {
    expandInspector();
  } else {
    collapseInspector();
  }
}

/**
 * Sync the header toggle button's aria-expanded state and label to match the
 * current inspector visibility.
 */
function syncInspectorToggleAria() {
  if (!inspectorToggle) return;
  const collapsed = inspector?.classList.contains("collapsed") ?? false;
  inspectorToggle.setAttribute("aria-expanded", String(!collapsed));
  inspectorToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand inspector" : "Collapse inspector"
  );
  inspectorToggle.title = collapsed ? "Expand inspector" : "Collapse inspector";
}

/**
 * Ensure the inspector starts open by default. Collapse state is not persisted
 * across reloads, so the panel is reliably open until the user toggles it.
 */
function restoreInspectorCollapsedState() {
  expandInspector();
}
restoreInspectorCollapsedState();

// Multi-select summary element — a subtle status item in the bottom bar
// rather than a block of text in the inspector.
/** @type {HTMLElement|null} */
let multiSelectInfo = null;
function _getMultiSelectInfoEl() {
  if (multiSelectInfo) return multiSelectInfo;
  multiSelectInfo = document.getElementById("bottomBarSelection");
  return multiSelectInfo;
}

/**
 * Multi-selections get a summary instead of per-node material controls:
 * group transforms happen in the viewport; time travel and material edits
 * stay single-selection features.
 *
 * @param {number} count
 */
function showMultiSelectSummary(count) {
  activeNodeId = null;
  activeMeshName = null;
  if (parametricEditor) parametricEditor.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (componentEditor) componentEditor.hidden = true;
  if (scaleSection) scaleSection.hidden = true;
  const el = _getMultiSelectInfoEl();
  if (el) {
    el.textContent = `${count} nodes selected — transform together; edits need single selection`;
    el.hidden = false;
  }
}

/**
 * Show the parametric editor for a regular node.
 *
 * @param {string} nodeId
 */
async function openInspector(nodeId) {
  activeNodeId = nodeId;
  activeMeshName = null;
  originalMaterialColors = {};
  if (multiSelectInfo) multiSelectInfo.hidden = true;

  const childRef = getNodeChildRef(nodeId);
  if (childRef) {
    showTokenChildInfo(nodeId);
    expandInspector();
    return;
  }

  if (parametricEditor) parametricEditor.hidden = false;
  if (parametricEditorDetails) parametricEditorDetails.open = false;
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  _refreshScaleFields();

  // Capture original material colors so close() can revert the preview.
  for (const { name, mesh } of getNodeSubMeshes(nodeId)) {
    const color = getMeshMaterialColor(mesh);
    if (color) originalMaterialColors[name] = color;
  }

  // Edit the first sub-mesh by default. Users can switch components by
  // clicking directly on parts in the 3D viewport.
  const subMeshes = getNodeSubMeshes(nodeId);
  if (subMeshes.length >= 1) {
    const first = subMeshes[0].name;
    selectComponent(first);
    selectSubMesh(nodeId, first);
  }

  expandInspector();
}

/**
 * Close the inspector: revert the live preview to the colors captured at open.
 */
function closeInspector() {
  if (activeNodeId) {
    const meshes = getNodeMeshes(activeNodeId);
    if (meshes && Object.keys(originalMaterialColors).length > 0) {
      /** @type {Record<string, {color: string}>} */
      const revertOverrides = {};
      for (const [name, color] of Object.entries(originalMaterialColors)) {
        revertOverrides[name] = { color };
      }
      applyColor(meshes, null, revertOverrides);
    }
    clearPendingSourceColorEdit(activeNodeId);
  }

  activeNodeId = null;
  activeMeshName = null;
  originalMaterialColors = {};
  // NOTE: we intentionally do not collapse the panel here. The user controls
  // collapse explicitly via the X button; programmatic scene clears should not
  // hide the panel.
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (parametricEditor) parametricEditor.hidden = false;
  if (componentEditor) componentEditor.hidden = true;
  if (scaleSection) scaleSection.hidden = true;
  deselectAll();
}

/**
 * Activate a component in the inspector: show the single color editor for it.
 *
 * @param {string} meshName
 */
function selectComponent(meshName) {
  if (!activeNodeId) return;
  if (activeMeshName === meshName) return;
  activeMeshName = meshName;

  // Find the mesh and its color for the editor.
  const subMeshes = getNodeSubMeshes(activeNodeId);
  const match = subMeshes.find((s) => s.name === meshName);
  const color = match
    ? getMeshMaterialColor(match.mesh) || "#ffffff"
    : "#ffffff";

  if (selectedComponentName) selectedComponentName.textContent = meshName;
  if (selectedComponentSwatch)
    selectedComponentSwatch.style.backgroundColor = color;
  if (selectedComponentColor) {
    selectedComponentColor.value = color;
    selectedComponentColor.dataset.meshName = meshName;
  }

  if (componentEditor) componentEditor.hidden = false;
  if (parametricEditorDetails) parametricEditorDetails.open = true;
}

/**
 * Live preview: the selected component's color changed.
 * Live preview: the selected component's color changed.
 * Applies the color immediately to the viewport and records it for Save.
 *
 * @param {Event} e
 */
function onComponentColorChange(e) {
  if (!activeNodeId) return;
  const target = /** @type {HTMLInputElement|null} */ (e.target);
  const meshName = target?.dataset?.meshName || activeMeshName;
  if (!meshName) return;

  const color = target?.value || "#ffffff";

  // Live preview: only touch this component.
  const meshes = getNodeMeshes(activeNodeId);
  applyColor(meshes, null, { [meshName]: { color } });

  // Sync the editor swatch to match.
  if (selectedComponentSwatch)
    selectedComponentSwatch.style.backgroundColor = color;

  // Record for Save/Publish to bake into the source asset.
  let nodeEdits = pendingSourceColorEdits.get(activeNodeId);
  if (!nodeEdits) {
    nodeEdits = new Map();
    pendingSourceColorEdits.set(activeNodeId, nodeEdits);
  }
  nodeEdits.set(meshName, color);
}

// Pending source color edit accessors (consumed by asset-save.js).
export function getPendingSourceColorEdits() {
  return pendingSourceColorEdits;
}

export function clearPendingSourceColorEdits() {
  pendingSourceColorEdits.clear();
}

/**
 * @param {string} nodeId
 */
export function clearPendingSourceColorEdit(nodeId) {
  pendingSourceColorEdits.delete(nodeId);
}

// Event bindings
/**
 * @param {{nodeId: string}} e
 */
function onNodeSelected(e) {
  // Multi-select: the inspector shows a summary instead of per-node controls.
  if (state.selectedNodeIds.size > 1) {
    showMultiSelectSummary(state.selectedNodeIds.size);
    return;
  }
  selectNodeById(e.nodeId);
  // Single click updates the inspector content when the panel is open, but
  // does not expand it when the user has explicitly collapsed it.
  if (inspector && !inspector.classList.contains("collapsed")) {
    openInspector(e.nodeId);
  } else {
    activeNodeId = e.nodeId || null;
    activeMeshName = null;
  }
}
on(EVENTS.NODE_SELECTED, onNodeSelected);

// Keep the summary count in sync as nodes are toggled in/out.
on(EVENTS.SELECTION_CHANGED, (/** @type {{nodeIds?: string[]}} */ e) => {
  const count = Array.isArray(e?.nodeIds) ? e.nodeIds.length : 0;
  if (count > 1) {
    showMultiSelectSummary(count);
  } else if (multiSelectInfo) {
    multiSelectInfo.hidden = true;
  }
});

/**
 * @param {{nodeId: string}} e
 */
function onNodeDoubleClicked(e) {
  selectNodeById(e.nodeId);
  openInspector(e.nodeId);
}
on(EVENTS.NODE_DOUBLE_CLICKED, onNodeDoubleClicked);

/**
 * @param {{nodeId: string, additive?: boolean}} e
 */
function onOutlinerNodeSelected(e) {
  if (e?.additive) {
    // Ctrl/Cmd+click in the outliner: multi-select summary. The matching
    // SELECTION_CHANGED event keeps the count accurate.
    showMultiSelectSummary(Math.max(state.selectedNodeIds.size, 2));
    return;
  }
  selectNodeById(e.nodeId);
  openInspector(e.nodeId);
}
on(EVENTS.OUTLINER_NODE_SELECTED, onOutlinerNodeSelected);

// Sub-mesh selected from the viewport: sync the inspector to that component.
on(EVENTS.SUBMESH_SELECTED, (/** @type {{meshName?: string}} */ e) => {
  const meshName = e?.meshName;
  if (!meshName || !activeNodeId) return;
  selectComponent(meshName);
});

// Inspector toggle + reveal buttons (same behavior as the left sidebar)
if (inspectorToggle) inspectorToggle.addEventListener("click", toggleInspector);
if (inspectorReveal) inspectorReveal.addEventListener("click", expandInspector);

// Dive button for child assets
const diveBtn = document.getElementById("inspectorDiveBtn");
if (diveBtn) {
  diveBtn.addEventListener("click", () => {
    const childRef = activeNodeId ? getNodeChildRef(activeNodeId) : null;
    if (childRef) {
      emit(EVENTS.NESTING_DIVE_REQUESTED, { childRef, nodeId: activeNodeId });
    }
  });
}

// After a save, the live preview colors are now the committed colors.
on(EVENTS.ASSET_DRAFT_SAVED, () => {
  if (activeNodeId) {
    for (const { name, mesh } of getNodeSubMeshes(activeNodeId)) {
      const color = getMeshMaterialColor(mesh);
      if (color) originalMaterialColors[name] = color;
    }
  }
});

if (nodeColorInput) nodeColorInput.addEventListener("input", () => {});
if (nodeScaleFactor) {
  nodeScaleFactor.addEventListener("change", () => {
    _applyUniformScale(Number.parseFloat(nodeScaleFactor.value));
  });
}
if (nodeScalePercent) {
  nodeScalePercent.addEventListener("change", () => {
    _applyUniformScale(Number.parseFloat(nodeScalePercent.value) / 100);
  });
}
if (selectedComponentColor) {
  // Capture the color before the user starts dragging the picker
  selectedComponentColor.addEventListener("pointerdown", () => {
    _colorBeforeEdit = selectedComponentColor.value;
  });
  // Live preview while dragging
  selectedComponentColor.addEventListener("input", onComponentColorChange);
  // Push one undo entry when the picker closes (end of gesture)
  selectedComponentColor.addEventListener("change", (e) => {
    if (!activeNodeId || !activeMeshName) return;
    const target = /** @type {HTMLInputElement} */ (e.target);
    const newColor = target.value;
    if (_colorBeforeEdit && _colorBeforeEdit !== newColor) {
      pushUndoEntry({
        type: "color",
        label: "Color",
        items: [
          {
            nodeId: activeNodeId,
            meshName: activeMeshName,
            before: _colorBeforeEdit,
            after: newColor,
          },
        ],
      });
    }
    _colorBeforeEdit = null;
  });
}

// Update token child CID when resolution completes and we're showing the info
/**
 * @param {{nodeId?: string, resolvedCid?: string}} e
 */
function onTokenChildAdded(e) {
  if (e?.nodeId === activeNodeId && tokenChildCidEl) {
    tokenChildCidEl.textContent = e.resolvedCid || "Resolving…";
  }
}
on(EVENTS.SCENE_TOKEN_CHILD_ADDED, onTokenChildAdded);
on(EVENTS.SCENE_CLEARED, closeInspector);

// Keep the scale fields in sync after a viewport gizmo drag stages a new
// transform for the node shown in the inspector.
on(EVENTS.TRANSFORM_STAGED, (/** @type {{nodeIds?: string[]}} */ e) => {
  if (!activeNodeId || !Array.isArray(e?.nodeIds)) return;
  if (e.nodeIds.includes(activeNodeId)) _refreshScaleFields();
});

export { openInspector, closeInspector };
