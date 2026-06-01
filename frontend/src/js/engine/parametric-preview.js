/**
 * Arbesk Parametric Preview & Token Child Inspector
 *
 * Binds Node Inspector inputs to live Babylon.js material/mesh updates.
 * Handles save (POST to backend) and cancel (revert to committed state).
 * Shows read-only token child info for child_ref nodes.
 */

import {
  updateNodeToVersion,
  getNodeVariants,
  appendHistoryEntry,
  applyColor,
  applyScale,
} from "./time-travel.js";
import { getNodeMeshes, getNodeChildRef } from "./scene-graph.js";

// DOM references
const inspector = document.getElementById("inspector");
const parametricEditor = document.getElementById("parametricEditor");
const tokenChildInfo = document.getElementById("tokenChildInfo");
const nodeColorInput = document.getElementById("nodeColor");
const nodeScaleX = document.getElementById("nodeScaleX");
const nodeScaleY = document.getElementById("nodeScaleY");
const nodeScaleZ = document.getElementById("nodeScaleZ");
const saveBtn = document.getElementById("saveParametric");
const cancelBtn = document.getElementById("cancelParametric");

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
let draftState = null;
let committedState = null;
let isSaving = false;

/**
 * Show the Token Child Info panel for a child_ref node.
 */
function showTokenChildInfo(nodeId) {
  if (parametricEditor) parametricEditor.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = false;

  const childRef = getNodeChildRef(nodeId);
  if (childRef && tokenChildIdEl) {
    tokenChildIdEl.textContent = `Token #${childRef.tokenId || "—"}`;
  }
  if (tokenChildContractEl) {
    tokenChildContractEl.textContent = childRef?.contractAddress
      ? `${childRef.contractAddress.slice(
          0,
          10
        )}…${childRef.contractAddress.slice(-6)}`
      : "—";
  }
  if (tokenChildChainEl) {
    tokenChildChainEl.textContent = childRef?.chainId || "—";
  }
  if (tokenChildResolutionEl) {
    tokenChildResolutionEl.textContent = childRef?.resolution || "latest";
  }
  if (tokenChildCidEl) {
    tokenChildCidEl.textContent = childRef?.resolvedCid || "—";
  }

  // Hide timeline for token children (no local history)
  timeline.hidden = true;

  inspector.hidden = false;
}

/**
 * Show the parametric editor for a regular node.
 */
function openInspector(nodeId) {
  activeNodeId = nodeId;

  // Check if this is a token child node
  const childRef = getNodeChildRef(nodeId);
  if (childRef) {
    showTokenChildInfo(nodeId);
    return;
  }

  // Regular node — show parametric editor
  if (parametricEditor) parametricEditor.hidden = false;
  if (tokenChildInfo) tokenChildInfo.hidden = true;

  const meshes = getNodeMeshes(nodeId);
  if (!meshes || meshes.length === 0) return;

  // Read current committed values from the mesh
  const rootMesh = meshes.find((m) => m.metadata?.isNodeRoot) || meshes[0];

  let currentColor = "#ffffff";
  let currentScale = { x: 1, y: 1, z: 1 };

  if (rootMesh.material) {
    const color =
      rootMesh.material.diffuseColor || rootMesh.material.albedoColor;
    if (color) {
      currentColor = color.toHexString();
    }
  }

  currentScale = {
    x: rootMesh.scaling.x,
    y: rootMesh.scaling.y,
    z: rootMesh.scaling.z,
  };

  committedState = {
    color: currentColor,
    scale: { ...currentScale },
  };

  draftState = {
    color: currentColor,
    scale: { ...currentScale },
  };

  // Set inputs
  if (nodeColorInput) nodeColorInput.value = currentColor;
  if (nodeScaleX) nodeScaleX.value = currentScale.x;
  if (nodeScaleY) nodeScaleY.value = currentScale.y;
  if (nodeScaleZ) nodeScaleZ.value = currentScale.z;

  // Show inspector
  inspector.hidden = false;

  // Bind timeline
  bindTimeline(nodeId);
}

/**
 * Close the inspector and reset state.
 */
function closeInspector() {
  activeNodeId = null;
  draftState = null;
  committedState = null;
  inspector.hidden = true;
  timeline.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (parametricEditor) parametricEditor.hidden = false;
}

/**
 * Bind the timeline slider to the node's history.
 */
function bindTimeline(nodeId) {
  const variants = getNodeVariants(nodeId);
  if (variants.length > 1) {
    timeline.hidden = false;
    versionSlider.min = 0;
    versionSlider.max = variants.length - 1;
    versionSlider.value = variants.length - 1;
    versionLabel.textContent = `v${variants.length}`;
  } else {
    timeline.hidden = true;
  }
}

/**
 * Live preview: update mesh color from input.
 */
function onColorChange() {
  if (!activeNodeId || !draftState) return;
  draftState.color = nodeColorInput.value;
  const meshes = getNodeMeshes(activeNodeId);
  applyColor(meshes, draftState.color);
}

/**
 * Live preview: update mesh scale from inputs.
 */
function onScaleChange() {
  if (!activeNodeId || !draftState) return;
  draftState.scale = {
    x: parseFloat(nodeScaleX.value),
    y: parseFloat(nodeScaleY.value),
    z: parseFloat(nodeScaleZ.value),
  };
  const meshes = getNodeMeshes(activeNodeId);
  applyScale(meshes, draftState.scale);
}

/**
 * Save parametric version to backend.
 */
async function onSave() {
  if (!activeNodeId || isSaving) return;
  isSaving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const body = {
      nodeId: activeNodeId,
      prevAssetManifestCid: window.activeAssetManifestCid,
      color:
        draftState.color !== committedState.color
          ? draftState.color
          : undefined,
      scale:
        draftState.scale.x !== committedState.scale.x ||
        draftState.scale.y !== committedState.scale.y ||
        draftState.scale.z !== committedState.scale.z
          ? draftState.scale
          : undefined,
    };

    // Only send if something changed
    if (!body.color && !body.scale) {
      closeInspector();
      isSaving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Variant";
      return;
    }

    const response = await fetch("/api/assets/save-variant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const result = await response.json();

    // Update global manifest
    window.activeAssetManifestCid = result.assetManifestCid;
    window.latestAssetManifestCid = result.assetManifestCid;

    // Append to local history
    appendHistoryEntry(activeNodeId, result.variantEntry);

    // Update committed state to draft state
    committedState = {
      color: draftState.color,
      scale: { ...draftState.scale },
    };

    // Refresh timeline
    bindTimeline(activeNodeId);

    document.dispatchEvent(
      new CustomEvent("parametric:save", {
        detail: { nodeId: activeNodeId, result },
      })
    );

    document.dispatchEvent(
      new CustomEvent("asset:draftSaved", {
        detail: { cid: result.assetManifestCid },
      })
    );

    closeInspector();
  } catch (error) {
    console.error("Failed to save parametric version:", error);
    alert("Save failed: " + error.message);
  } finally {
    isSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Variant";
  }
}

/**
 * Cancel: revert mesh to last committed state.
 */
function onCancel() {
  if (!activeNodeId || !committedState) return;
  const meshes = getNodeMeshes(activeNodeId);
  applyColor(meshes, committedState.color);
  applyScale(meshes, committedState.scale);
  closeInspector();
}

/**
 * Timeline slider change handler.
 */
function onTimelineChange() {
  if (!activeNodeId) return;
  const index = parseInt(versionSlider.value, 10);
  updateNodeToVersion(activeNodeId, index);
  const variants = getNodeVariants(activeNodeId);
  const entry = variants[index];
  versionLabel.textContent = `v${entry?.v || index + 1}`;
}

// Event bindings
document.addEventListener("node:selected", (e) => {
  openInspector(e.detail.nodeId);
});

if (nodeColorInput) nodeColorInput.addEventListener("input", onColorChange);
if (nodeScaleX) nodeScaleX.addEventListener("input", onScaleChange);
if (nodeScaleY) nodeScaleY.addEventListener("input", onScaleChange);
if (nodeScaleZ) nodeScaleZ.addEventListener("input", onScaleChange);
if (saveBtn) saveBtn.addEventListener("click", onSave);
if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
if (versionSlider) versionSlider.addEventListener("input", onTimelineChange);

document.addEventListener("wallet:connected", () => {});
document.addEventListener("wallet:disconnected", () => {});

// Update token child CID when resolution completes and we're showing the info
document.addEventListener("scene:tokenChildAdded", (e) => {
  if (e.detail?.nodeId === activeNodeId && tokenChildCidEl) {
    tokenChildCidEl.textContent = e.detail.resolvedCid || "Resolving…";
  }
});

export { openInspector, closeInspector };
