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

import {
  applyManifestVersion,
  walkManifestChain,
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
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

// DOM references
const inspector = document.getElementById("inspector");
const parametricEditor = document.getElementById("parametricEditor");
const tokenChildInfo = document.getElementById("tokenChildInfo");
const nodeColorInput = document.getElementById("nodeColor");
const nodeScaleX = document.getElementById("nodeScaleX");
const nodeScaleY = document.getElementById("nodeScaleY");
const nodeScaleZ = document.getElementById("nodeScaleZ");
const componentList = document.getElementById("componentList");
const componentListBody = document.getElementById("componentListBody");
const componentEditor = document.getElementById("componentEditor");
const selectedComponentName = document.getElementById("selectedComponentName");
const selectedComponentSwatch = document.getElementById("selectedComponentSwatch");
const selectedComponentColor = document.getElementById("selectedComponentColor");
const timeline = document.getElementById("timeline");
const versionSlider = document.getElementById("versionSlider");
const versionLabel = document.getElementById("versionLabel");

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
// Cached manifest chain for the currently open node (used by timeline slider)
let currentChain = [];

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Build the component list from the active node's sub-meshes.
 * Rows are clickable selectors; the actual color editor lives in #componentEditor.
 */
function buildComponentList(nodeId) {
  if (!componentList || !componentListBody) return;

  const subMeshes = getNodeSubMeshes(nodeId);
  if (subMeshes.length <= 1) {
    componentList.hidden = true;
    componentListBody.innerHTML = "";
    return;
  }

  componentList.hidden = false;

  let html = "";
  for (const { name, mesh } of subMeshes) {
    const color = getMeshMaterialColor(mesh) || "#ffffff";
    html += `
      <div class="component-row" data-mesh-name="${escapeHtml(name)}">
        <span class="component-label">${escapeHtml(name)}</span>
        <span class="component-swatch" style="background-color: ${color};" aria-hidden="true"></span>
      </div>`;
  }

  componentListBody.innerHTML = html;

  for (const row of componentListBody.querySelectorAll(".component-row")) {
    row.addEventListener("click", onComponentRowClick);
  }
}

/**
 * Show the Token Child Info panel for a child_ref node.
 */
function showTokenChildInfo(nodeId) {
  if (parametricEditor) parametricEditor.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = false;
  if (componentList) componentList.hidden = true;
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

  timeline.hidden = true;
  inspector.classList.remove("collapsed");
}

/**
 * Show the parametric editor for a regular node.
 */
async function openInspector(nodeId) {
  activeNodeId = nodeId;
  activeMeshName = null;
  originalMaterialColors = {};

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

  buildComponentList(nodeId);

  // If there is only one component, edit it immediately; otherwise wait for
  // the user to pick a component from the list or the viewport.
  const subMeshes = getNodeSubMeshes(nodeId);
  if (subMeshes.length === 1) {
    selectComponent(subMeshes[0].name);
  } else if (subMeshes.length > 1) {
    if (componentEditor) componentEditor.hidden = true;
  }

  inspector.classList.remove("collapsed");
  bindTimeline(nodeId);
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
  currentChain = [];
  inspector.classList.add("collapsed");
  timeline.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (parametricEditor) parametricEditor.hidden = false;
  if (componentList) {
    componentList.hidden = true;
    if (componentListBody) componentListBody.innerHTML = "";
  }
  if (componentEditor) componentEditor.hidden = true;
  deselectAll();
}

/**
 * Activate a component in the inspector: highlight its row, update the 3D
 * selection, and show the single color editor for it.
 */
function selectComponent(meshName) {
  if (!activeNodeId || !componentListBody) return;
  if (activeMeshName === meshName) return;
  activeMeshName = meshName;

  // Update list active state.
  for (const row of componentListBody.querySelectorAll(".component-row")) {
    row.classList.toggle("component-row--active", row.dataset.meshName === meshName);
  }

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

  // Reveal the editor before syncing the viewport so the submesh:selected
  // guard sees we are already editing this component and does not recurse.
  if (componentEditor) componentEditor.hidden = false;

  // Update 3D selection to match.
  selectSubMesh(activeNodeId, meshName);
}

function onComponentRowClick(e) {
  const row = e.currentTarget;
  const meshName = row?.dataset?.meshName;
  if (!meshName || !activeNodeId) return;
  selectComponent(meshName);
}

/**
 * Bind the timeline slider to the node's manifest chain.
 */
async function bindTimeline(nodeId) {
  const manifestCid = window.activeAssetManifestCid || window.latestAssetManifestCid;
  if (!manifestCid) {
    timeline.hidden = true;
    return;
  }

  currentChain = await walkManifestChain(manifestCid);

  if (currentChain.length > 1) {
    timeline.hidden = false;
    versionSlider.min = 0;
    versionSlider.max = currentChain.length - 1;
    versionSlider.value = currentChain.length - 1;
    const latestEntry = currentChain[currentChain.length - 1];
    versionLabel.textContent = `v${latestEntry.version || currentChain.length}`;
  } else {
    timeline.hidden = true;
  }
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

  // Sync the list swatch to match.
  const row = componentListBody?.querySelector(`[data-mesh-name="${CSS.escape(meshName)}"]`);
  const swatch = row?.querySelector(".component-swatch");
  if (swatch) swatch.style.backgroundColor = color;
  if (selectedComponentSwatch) selectedComponentSwatch.style.backgroundColor = color;

  // Record for Save/Publish to bake into the source asset.
  let nodeEdits = pendingSourceColorEdits.get(activeNodeId);
  if (!nodeEdits) {
    nodeEdits = new Map();
    pendingSourceColorEdits.set(activeNodeId, nodeEdits);
  }
  nodeEdits.set(meshName, color);
}

/**
 * Timeline slider change handler.
 */
function onTimelineChange() {
  if (!activeNodeId || currentChain.length === 0) return;
  const index = parseInt(versionSlider.value, 10);
  const entry = currentChain[index];
  if (!entry) return;

  applyManifestVersion(activeNodeId, entry.cid);
  versionLabel.textContent = `v${entry.version || index + 1}`;
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
document.addEventListener("node:selected", onNodeSelected);
document.addEventListener("outliner:nodeSelected", onNodeSelected);

// Sub-mesh selected from the viewport: sync the inspector to that component.
document.addEventListener("submesh:selected", (e) => {
  if (!componentList || componentList.hidden) return;
  const meshName = e.detail?.meshName;
  if (!meshName) return;
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
      document.dispatchEvent(
        new CustomEvent("nesting:diveRequested", {
          detail: { childRef, nodeId: activeNodeId },
        })
      );
    }
  });
}

// After a save, the live preview colors are now the committed colors.
document.addEventListener("asset:draftSaved", () => {
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
if (selectedComponentColor) selectedComponentColor.addEventListener("input", onComponentColorChange);
if (versionSlider) versionSlider.addEventListener("input", onTimelineChange);

// Update token child CID when resolution completes and we're showing the info
function onTokenChildAdded(e) {
  if (e.detail?.nodeId === activeNodeId && tokenChildCidEl) {
    tokenChildCidEl.textContent = e.detail.resolvedCid || "Resolving…";
  }
}
document.addEventListener("scene:tokenChildAdded", onTokenChildAdded);

export { openInspector, closeInspector };
