// @ts-nocheck
/**
 * Arbesk Scene Selection
 *
 * Node/sub-mesh selection, highlight management, and deselection.
 * Extracted from scene-graph.js to keep that file focused on scene construction.
 *
 * Multi-select: `state.selectedNodeIds` holds the full selection set;
 * `state.highlightedNodeId` is the primary (last-added) member. Single-node
 * consumers (inspector, sub-mesh toggle, model clock) act only when the set
 * has exactly one entry.
 */

import { emit, EVENTS } from "../events/bus.js";
import { uiState } from "../state/ui-state.js";
import { state } from "./state.js";
import { getCssVar, hexToColor3 } from "./theme.js";

function _amberColor() {
  return (
    hexToColor3(getCssVar("--highlight-amber")) ||
    BABYLON.Color3.FromHexString("#D4A017")
  );
}

function _addNodeHighlight(nodeId, meshName = null) {
  const meshes = state.nodeMeshes.get(nodeId);
  if (!meshes || !state.highlightLayer) return;
  const amber = _amberColor();
  for (const m of meshes) {
    if (m && !m.isDisposed() && (!meshName || m.name === meshName)) {
      state.highlightLayer.addMesh(m, amber);
    }
  }
}

function _removeNodeHighlight(nodeId) {
  if (!state.highlightLayer || !nodeId) return;
  const meshes = state.nodeMeshes.get(nodeId);
  if (!meshes) return;
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

function _emitSelectionChanged() {
  emit(EVENTS.SELECTION_CHANGED, {
    nodeIds: [...state.selectedNodeIds],
  });
}

/**
 * Single-select: collapse the selection to exactly this node.
 */
function selectNode(nodeId, mesh) {
  const alreadySingle =
    state.highlightedNodeId === nodeId &&
    state.selectedNodeIds.size === 1 &&
    state.selectedNodeIds.has(nodeId) &&
    !state.highlightedSubMeshName;
  if (alreadySingle) return;

  for (const id of state.selectedNodeIds) _removeNodeHighlight(id);
  state.selectedNodeIds.clear();
  state.selectedNodeIds.add(nodeId);
  state.highlightedSubMeshName = null;
  _addNodeHighlight(nodeId);
  state.highlightedNodeId = nodeId;
  uiState.set({ selectedNodeId: nodeId });
  emit(EVENTS.NODE_SELECTED, { nodeId, mesh });
  _emitSelectionChanged();
}

/**
 * Ctrl/Cmd+click: toggle a node in/out of the multi-selection. The most
 * recently added node becomes the primary (`highlightedNodeId`); removing the
 * primary promotes the last remaining member.
 */
function toggleNodeSelection(nodeId, mesh) {
  if (state.selectedNodeIds.has(nodeId)) {
    state.selectedNodeIds.delete(nodeId);
    _removeNodeHighlight(nodeId);
    if (state.selectedNodeIds.size === 0) {
      state.highlightedNodeId = null;
      state.highlightedSubMeshName = null;
      uiState.set({ selectedNodeId: null });
      emit(EVENTS.NODE_DESELECTED);
    } else if (state.highlightedNodeId === nodeId) {
      const remaining = [...state.selectedNodeIds];
      const primary = remaining[remaining.length - 1];
      state.highlightedNodeId = primary;
      state.highlightedSubMeshName = null;
      uiState.set({ selectedNodeId: primary });
      emit(EVENTS.NODE_SELECTED, { nodeId: primary, mesh: null });
    }
  } else {
    state.selectedNodeIds.add(nodeId);
    state.highlightedSubMeshName = null;
    _addNodeHighlight(nodeId);
    state.highlightedNodeId = nodeId;
    uiState.set({ selectedNodeId: nodeId });
    emit(EVENTS.NODE_SELECTED, { nodeId, mesh });
  }
  _emitSelectionChanged();
}

/**
 * Select every given node at once (Ctrl+A). The last id becomes primary.
 * @param {string[]} nodeIds
 */
function selectAllNodes(nodeIds) {
  const ids = (nodeIds || []).filter(Boolean);
  if (ids.length === 0) return;
  for (const id of state.selectedNodeIds) _removeNodeHighlight(id);
  state.selectedNodeIds.clear();
  for (const id of ids) {
    state.selectedNodeIds.add(id);
    _addNodeHighlight(id);
  }
  const primary = ids[ids.length - 1];
  state.highlightedNodeId = primary;
  state.highlightedSubMeshName = null;
  uiState.set({ selectedNodeId: primary });
  emit(EVENTS.NODE_SELECTED, { nodeId: primary, mesh: null });
  _emitSelectionChanged();
}

function selectSubMesh(nodeId, meshName) {
  // Sub-mesh selection is a single-node concept: collapse the set first.
  if (nodeId !== state.highlightedNodeId || state.selectedNodeIds.size > 1) {
    for (const id of state.selectedNodeIds) _removeNodeHighlight(id);
    state.selectedNodeIds.clear();
    state.selectedNodeIds.add(nodeId);
    state.highlightedNodeId = nodeId;
    uiState.set({ selectedNodeId: nodeId });
  } else {
    _removeNodeHighlight(nodeId);
  }
  _addNodeHighlight(nodeId, meshName);
  state.highlightedSubMeshName = meshName;
  emit(EVENTS.SUBMESH_SELECTED, { nodeId, meshName });
  _emitSelectionChanged();
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
  for (const id of state.selectedNodeIds) _removeNodeHighlight(id);
}

/**
 * Deselect everything: clear highlight, reset state, dispatch events.
 */
function deselectAll() {
  clearHighlight();
  state.selectedNodeIds.clear();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
  uiState.set({ selectedNodeId: null });
  emit(EVENTS.NODE_DESELECTED);
  _emitSelectionChanged();
}

export {
  selectNode,
  toggleNodeSelection,
  selectAllNodes,
  selectSubMesh,
  selectNodeById,
  clearHighlight,
  deselectAll,
};
