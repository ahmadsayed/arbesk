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

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { emit, on, EVENTS } from "../events/registry.js";
import {
  applyColor,
  applyScale,
} from "./time-travel.js";
import {
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  deselectAll,
  selectNodeById,
  selectSubMesh,
} from "./scene-graph.js";

// DOM references
const inspector = document.getElementById("inspector");
const parametricEditor = document.getElementById("parametricEditor");
const tokenChildInfo = document.getElementById("tokenChildInfo");
const nodeColorInput = document.getElementById("nodeColor");
const nodeScaleX = document.getElementById("nodeScaleX");
const nodeScaleY = document.getElementById("nodeScaleY");
const nodeScaleZ = document.getElementById("nodeScaleZ");
const componentEditor = document.getElementById("componentEditor");
const selectedComponentName = document.getElementById("selectedComponentName");
const selectedComponentSwatch = document.getElementById("selectedComponentSwatch");
const selectedComponentColor = document.getElementById("selectedComponentColor");

// Token child info elements
const tokenChildIdEl = document.getElementById("tokenChildId");
const tokenChildContractEl = document.getElementById("tokenChildContract");
const tokenChildChainEl = document.getElementById("tokenChildChain");
const tokenChildResolutionEl = document.getElementById("tokenChildResolution");
const tokenChildCidEl = document.getElementById("tokenChildCid");

// State
let activeNodeId = null;
let activeMeshName = null;
// Original material colors captured at inspector open, used to revert on close.
let originalMaterialColors = {};
// Pending direct source color edits: Map<nodeId, Map<meshName, hexColor>>
const pendingSourceColorEdits = new Map();

// ── Undo / Redo ──────────────────────────────────────────────────────────────

const undoStack = [];
const redoStack = [];
const MAX_UNDO = 20;

let _colorBeforeEdit = null;

function _pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function _clearUndoRedo() {
  undoStack.length = 0;
  redoStack.length = 0;
}

function _applyUndoEntry(entry, color) {
  const { nodeId, meshName } = entry;
  const meshes = getNodeMeshes(nodeId);
  if (meshes) applyColor(meshes, null, { [meshName]: { color } });

  // Sync the inspector UI if it's showing this node/mesh
  if (activeNodeId === nodeId && activeMeshName === meshName) {
    if (selectedComponentColor) selectedComponentColor.value = color;
    if (selectedComponentSwatch) selectedComponentSwatch.style.backgroundColor = color;
  }

  // Keep pending edits in sync so Save writes the undone/redone color
  let nodeEdits = pendingSourceColorEdits.get(nodeId);
  if (!nodeEdits) {
    nodeEdits = new Map();
    pendingSourceColorEdits.set(nodeId, nodeEdits);
  }
  nodeEdits.set(meshName, color);
}

export function undoColorEdit() {
  const entry = undoStack.pop();
  if (!entry) return;
  _applyUndoEntry(entry, entry.oldColor);
  redoStack.push(entry);
}

export function redoColorEdit() {
  const entry = redoStack.pop();
  if (!entry) return;
  _applyUndoEntry(entry, entry.newColor);
  undoStack.push(entry);
}

/**
 * Read the current solid color from a mesh's material (diffuse or albedo).
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

/**
 * Show the Token Child Info panel for a child_ref node.
 */
function showTokenChildInfo(nodeId) {
  if (parametricEditor) parametricEditor.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = false;
  if (componentEditor) componentEditor.hidden = true;

  const childRef = getNodeChildRef(nodeId);
  if (childRef && tokenChildIdEl) {
    tokenChildIdEl.textContent = `Token #${childRef.tokenId || "—"}`;
  }
  if (tokenChildContractEl) {
    tokenChildContractEl.textContent = childRef?.contractAddress
      ? `${childRef.contractAddress.slice(0, 10)}…${childRef.contractAddress.slice(-6)}`
      : "—";
  }
  if (tokenChildChainEl) tokenChildChainEl.textContent = childRef?.chainId || "—";
  if (tokenChildResolutionEl) tokenChildResolutionEl.textContent = childRef?.resolution || "latest";
  if (tokenChildCidEl) tokenChildCidEl.textContent = childRef?.resolvedCid || "—";

  inspector.classList.remove("collapsed");
}

/**
 * Show the parametric editor for a regular node.
 */
async function openInspector(nodeId) {
  activeNodeId = nodeId;
  activeMeshName = null;
  originalMaterialColors = {};
  _clearUndoRedo();

  const childRef = getNodeChildRef(nodeId);
  if (childRef) {
    showTokenChildInfo(nodeId);
    return;
  }

  if (parametricEditor) parametricEditor.hidden = false;
  if (tokenChildInfo) tokenChildInfo.hidden = true;

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

  inspector.classList.remove("collapsed");
}

/**
 * Close the inspector: revert the live preview to the colors captured at open.
 */
function closeInspector() {
  if (activeNodeId) {
    const meshes = getNodeMeshes(activeNodeId);
    if (meshes && Object.keys(originalMaterialColors).length > 0) {
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
  _clearUndoRedo();
  inspector.classList.add("collapsed");
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (parametricEditor) parametricEditor.hidden = false;
  if (componentEditor) componentEditor.hidden = true;
  deselectAll();
}

/**
 * Activate a component in the inspector: show the single color editor for it.
 */
function selectComponent(meshName) {
  if (!activeNodeId) return;
  if (activeMeshName === meshName) return;
  activeMeshName = meshName;

  // Find the mesh and its color for the editor.
  const subMeshes = getNodeSubMeshes(activeNodeId);
  const match = subMeshes.find((s) => s.name === meshName);
  const color = match ? getMeshMaterialColor(match.mesh) || "#ffffff" : "#ffffff";

  if (selectedComponentName) selectedComponentName.textContent = meshName;
  if (selectedComponentSwatch) selectedComponentSwatch.style.backgroundColor = color;
  if (selectedComponentColor) {
    selectedComponentColor.value = color;
    selectedComponentColor.dataset.meshName = meshName;
  }

  if (componentEditor) componentEditor.hidden = false;
}

function readScaleInputs() {
  return {
    x: nodeScaleX ? parseFloat(nodeScaleX.value) : 1,
    y: nodeScaleY ? parseFloat(nodeScaleY.value) : 1,
    z: nodeScaleZ ? parseFloat(nodeScaleZ.value) : 1,
  };
}

/**
 * Live preview: the selected component's color changed.
 * Applies the color immediately to the viewport and records it for Save.
 */
function onComponentColorChange(e) {
  if (!activeNodeId) return;
  const meshName = e.target?.dataset?.meshName || activeMeshName;
  if (!meshName) return;

  const color = e.target.value;

  // Live preview: only touch this component.
  const meshes = getNodeMeshes(activeNodeId);
  applyColor(meshes, null, { [meshName]: { color } });

  // Sync the editor swatch to match.
  if (selectedComponentSwatch) selectedComponentSwatch.style.backgroundColor = color;

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

export function clearPendingSourceColorEdit(nodeId) {
  pendingSourceColorEdits.delete(nodeId);
}

// Event bindings
function onNodeSelected(e) {
  selectNodeById(e.detail.nodeId);
  openInspector(e.detail.nodeId);
}
on(EVENTS.NODE_SELECTED, onNodeSelected);
on(EVENTS.OUTLINER_NODE_SELECTED, onNodeSelected);

// Sub-mesh selected from the viewport: sync the inspector to that component.
on(EVENTS.SUBMESH_SELECTED, (e) => {
  const meshName = e.detail?.meshName;
  if (!meshName || !activeNodeId) return;
  selectComponent(meshName);
});

// Inspector close button
const inspectorCloseBtn = document.getElementById("inspectorCloseBtn");
if (inspectorCloseBtn) inspectorCloseBtn.addEventListener("click", closeInspector);

// Dive button for child worlds
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
if (nodeScaleX) nodeScaleX.addEventListener("input", () => {});
if (nodeScaleY) nodeScaleY.addEventListener("input", () => {});
if (nodeScaleZ) nodeScaleZ.addEventListener("input", () => {});
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
    const newColor = e.target.value;
    if (_colorBeforeEdit && _colorBeforeEdit !== newColor) {
      _pushUndo({ nodeId: activeNodeId, meshName: activeMeshName, oldColor: _colorBeforeEdit, newColor });
    }
    _colorBeforeEdit = null;
  });
}

// Ctrl+Z / Ctrl+Shift+Z — undo/redo color edits
document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z"))) return;
  const el = document.activeElement;
  const tag = el?.tagName?.toLowerCase();
  // Allow undo when a color input is focused; block for text fields
  const isColorInput = tag === "input" && el.type === "color";
  if (!isColorInput) {
    const editing = el?.isContentEditable || tag === "textarea" || tag === "select" ||
      (tag === "input");
    if (editing) return;
  }
  e.preventDefault();
  if (e.shiftKey) redoColorEdit();
  else undoColorEdit();
});

// Update token child CID when resolution completes and we're showing the info
function onTokenChildAdded(e) {
  if (e.detail?.nodeId === activeNodeId && tokenChildCidEl) {
    tokenChildCidEl.textContent = e.detail.resolvedCid || "Resolving…";
  }
}
on(EVENTS.SCENE_TOKEN_CHILD_ADDED, onTokenChildAdded);

export { openInspector, closeInspector };
