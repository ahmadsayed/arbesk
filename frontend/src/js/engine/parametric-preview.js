/**
 * Arbesk Parametric Preview & Token Child Inspector
 *
 * Binds Node Inspector inputs to live Babylon.js material/mesh updates.
 * Color and scale edits are accumulated into `state.pendingAppearanceEdits`
 * and committed by the headerbar Save Draft / Publish buttons — the
 * inspector no longer has its own Save / Cancel buttons (per GNOME HIG:
 * one obvious save action in the headerbar, not duplicated per panel).
 *
 * Closing the inspector (X) discards pending edits for the active node
 * and reverts the live preview to the last committed appearance.
 *
 * History timeline walks the manifest chain via `prev_asset_manifest_cid`
 * links. Timeline scrubs are view-only — they do not create pending edits.
 */

import {
  applyManifestVersion,
  walkManifestChain,
  applyColor,
  applyScale,
} from "./time-travel.js";
import {
  getNodeMeshes,
  getNodeChildRef,
  deselectAll,
  selectNodeById,
  getPendingAppearanceEdits,
  clearPendingAppearanceEdit,
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
// Last saved appearance for the active node — used to revert the live
// preview when the inspector closes without saving. Re-seeded on
// `asset:draftSaved` so close-after-save-and-edit reverts correctly.
let committedState = null;

// Cached manifest chain for the currently open node (used by timeline slider)
let currentChain = [];

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

  inspector.classList.remove("collapsed");
}

/**
 * Show the parametric editor for a regular node.
 */
async function openInspector(nodeId) {
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

  // Read current committed values from the manifest node
  let currentColor = "#ffffff";
  let currentScale = { x: 1, y: 1, z: 1 };

  const manifestCid =
    window.activeAssetManifestCid || window.latestAssetManifestCid;
  if (manifestCid) {
    try {
      const manifest = await getFromRemoteIPFS(manifestCid);
      const node = (manifest.scene?.nodes || []).find(
        (n) => n.node_id === nodeId
      );
      if (node) {
        if (node.appearance?.color) currentColor = node.appearance.color;
        if (node.appearance?.scale) currentScale = { ...node.appearance.scale };
      }
    } catch (err) {
      console.warn(
        `[PARAM] failed to fetch manifest for inspector:`,
        err.message
      );
    }
  }

  committedState = {
    color: currentColor,
    scale: { ...currentScale },
  };

  // Set inputs
  if (nodeColorInput) nodeColorInput.value = currentColor;
  if (nodeScaleX) nodeScaleX.value = currentScale.x;
  if (nodeScaleY) nodeScaleY.value = currentScale.y;
  if (nodeScaleZ) nodeScaleZ.value = currentScale.z;

  // Show inspector
  inspector.classList.remove("collapsed");

  // Bind timeline
  bindTimeline(nodeId);
}

/**
 * Close the inspector: revert the live preview to the last committed
 * appearance and discard any pending edits for the active node.
 * Save Draft / Publish is the only path to persistence now.
 */
function closeInspector() {
  if (activeNodeId && committedState) {
    const meshes = getNodeMeshes(activeNodeId);
    if (meshes) {
      applyColor(meshes, committedState.color);
      applyScale(meshes, committedState.scale);
    }
    clearPendingAppearanceEdit(activeNodeId);
  }

  activeNodeId = null;
  committedState = null;
  currentChain = [];
  inspector.classList.add("collapsed");
  timeline.hidden = true;
  if (tokenChildInfo) tokenChildInfo.hidden = true;
  if (parametricEditor) parametricEditor.hidden = false;
  deselectAll();
}

/**
 * Bind the timeline slider to the node's manifest chain.
 */
async function bindTimeline(nodeId) {
  const manifestCid =
    window.activeAssetManifestCid || window.latestAssetManifestCid;
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
 * Write the current color + scale inputs into the pending-edits map for
 * the active node. Both fields are always written together so that
 * Save Draft / Publish applies them atomically (no partial updates).
 */
function recordPendingEdit() {
  if (!activeNodeId) return;
  const pending = getPendingAppearanceEdits();
  const prev = pending.get(activeNodeId) || {};
  pending.set(activeNodeId, {
    color: nodeColorInput ? nodeColorInput.value : prev.color ?? "#ffffff",
    scale: readScaleInputs(),
  });
}

/**
 * Live preview: update mesh color from input and record the edit.
 */
function onColorChange() {
  if (!activeNodeId) return;
  const color = nodeColorInput ? nodeColorInput.value : null;
  const meshes = getNodeMeshes(activeNodeId);
  applyColor(meshes, color);
  recordPendingEdit();
}

/**
 * Live preview: update mesh scale from inputs and record the edit.
 */
function onScaleChange() {
  if (!activeNodeId) return;
  const scale = readScaleInputs();
  const meshes = getNodeMeshes(activeNodeId);
  applyScale(meshes, scale);
  recordPendingEdit();
}

/**
 * Timeline slider change handler.
 * Uses the cached manifest chain to apply the selected version's
 * color + scale to the active node without re-fetching. This is a
 * view-only operation — it does not create a pending edit.
 */
function onTimelineChange() {
  if (!activeNodeId || currentChain.length === 0) return;
  const index = parseInt(versionSlider.value, 10);
  const entry = currentChain[index];
  if (!entry) return;

  applyManifestVersion(activeNodeId, entry.cid);
  versionLabel.textContent = `v${entry.version || index + 1}`;
}

// Event bindings
function onNodeSelected(e) {
  selectNodeById(e.detail.nodeId);
  openInspector(e.detail.nodeId);
}
document.addEventListener("node:selected", onNodeSelected);
document.addEventListener("outliner:nodeSelected", onNodeSelected);

// Inspector close button
const inspectorCloseBtn = document.getElementById("inspectorCloseBtn");
if (inspectorCloseBtn)
  inspectorCloseBtn.addEventListener("click", closeInspector);

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

// After a save, the values in the inputs are now the committed values.
// Refresh `committedState` so a subsequent edit + close reverts to the
// just-saved state, not the pre-save one.
document.addEventListener("asset:draftSaved", () => {
  if (activeNodeId) {
    committedState = {
      color: nodeColorInput ? nodeColorInput.value : "#ffffff",
      scale: readScaleInputs(),
    };
  }
});

if (nodeColorInput) nodeColorInput.addEventListener("input", onColorChange);
if (nodeScaleX) nodeScaleX.addEventListener("input", onScaleChange);
if (nodeScaleY) nodeScaleY.addEventListener("input", onScaleChange);
if (nodeScaleZ) nodeScaleZ.addEventListener("input", onScaleChange);
if (versionSlider) versionSlider.addEventListener("input", onTimelineChange);

// Update token child CID when resolution completes and we're showing the info
function onTokenChildAdded(e) {
  if (e.detail?.nodeId === activeNodeId && tokenChildCidEl) {
    tokenChildCidEl.textContent = e.detail.resolvedCid || "Resolving…";
  }
}
document.addEventListener("scene:tokenChildAdded", onTokenChildAdded);

export { openInspector, closeInspector };
