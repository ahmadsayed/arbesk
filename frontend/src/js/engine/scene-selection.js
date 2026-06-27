// @ts-nocheck
/**
 * Arbesk Scene Selection
 *
 * Node/sub-mesh selection, highlight management, and deselection.
 * Extracted from scene-graph.js to keep that file focused on scene construction.
 */

import { emit, EVENTS } from "../events/bus.js";
import { uiState } from "../state/ui-state.js";
import { state } from "./state.js";
import { getCssVar, hexToColor3 } from "./theme.js";

function selectNode(nodeId, mesh) {
  if (nodeId === state.highlightedNodeId && !state.highlightedSubMeshName)
    return;
  clearHighlight();
  state.highlightedSubMeshName = null;
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes && state.highlightLayer) {
    const amber =
      hexToColor3(getCssVar("--highlight-amber")) ||
      BABYLON.Color3.FromHexString("#D4A017");
    for (const m of meshes) {
      if (m && !m.isDisposed()) state.highlightLayer.addMesh(m, amber);
    }
  }
  state.highlightedNodeId = nodeId;
  uiState.set({ selectedNodeId: nodeId });
  emit(EVENTS.NODE_SELECTED, { nodeId, mesh });
}

function selectSubMesh(nodeId, meshName) {
  if (nodeId !== state.highlightedNodeId) {
    clearHighlight();
    state.highlightedNodeId = nodeId;
    uiState.set({ selectedNodeId: nodeId });
  } else {
    clearHighlight();
  }
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes && state.highlightLayer) {
    const amber =
      hexToColor3(getCssVar("--highlight-amber")) ||
      BABYLON.Color3.FromHexString("#D4A017");
    for (const m of meshes) {
      if (m && !m.isDisposed() && m.name === meshName)
        state.highlightLayer.addMesh(m, amber);
    }
  }
  state.highlightedSubMeshName = meshName;
  emit(EVENTS.SUBMESH_SELECTED, { nodeId, meshName });
}

/**
 * Highlight a node by ID alone (from outliner or programmatic selection).
 * Does not re-fire node:selected if already highlighted.
 */
function selectNodeById(nodeId) {
  selectNode(nodeId, null);
}

/**
 * Remove all meshes from the highlight layer without changing selection state.
 */
function clearHighlight() {
  if (!state.highlightLayer) return;
  const prevId = state.highlightedNodeId;
  if (!prevId) return;
  const meshes = state.nodeMeshes.get(prevId);
  if (meshes) {
    for (const m of meshes) {
      if (m && !m.isDisposed()) {
        try {
          state.highlightLayer.removeMesh(m);
        } catch {
          // mesh may not be in the highlight layer
        }
      }
    }
  }
}

/**
 * Deselect the current node: clear highlight, reset state, dispatch event.
 */
function deselectAll() {
  clearHighlight();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
  uiState.set({ selectedNodeId: null });
  emit(EVENTS.NODE_DESELECTED);
}

export { selectNode, selectSubMesh, selectNodeById, clearHighlight, deselectAll };
