/**
 * Part removal: removes the selected part (a named sub-mesh) from a model,
 * e.g. the horns of a split goat.
 * @remarks Staged in memory — the part is hidden in the viewport and the
 *   Outline — and persisted on the next Save Draft / Publish, which rewrites
 *   the node's source glTF without it (manifest-builder →
 *   handler.removeSourceParts). Ctrl/Cmd+Z restores it. The previous version
 *   keeps the part, so time travel brings it back too.
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "./state.ts";
import { selectNode } from "./scene-selection.ts";
import { pushUndoEntry } from "./undo-stack.ts";
import { registerUndoApplier } from "./undo-controller.ts";
import { notifyPendingEditsChanged, registerPendingSource } from "../state/unsaved-changes.ts";

registerPendingSource(() => state.pendingPartRemovals.size > 0);

/** Pending removals, nodeId → removed sub-mesh names (consumed by save). */
export function getPendingPartRemovals(): Map<string, Set<string>> {
  return state.pendingPartRemovals;
}

export function clearPendingPartRemovals(): void {
  state.pendingPartRemovals.clear();
  notifyPendingEditsChanged();
}

function setPartVisible(nodeId: string, meshName: string, visible: boolean): void {
  for (const mesh of state.nodeMeshes.get(nodeId) || []) {
    if (mesh?.name !== meshName) continue;
    mesh.setEnabled(visible);
    mesh.isPickable = visible;
  }
}

/** Named, visible parts of a model — removal must leave at least one. */
function visiblePartCount(nodeId: string): number {
  const names = new Set<string>();
  for (const mesh of state.nodeMeshes.get(nodeId) || []) {
    if (!mesh?.name || mesh.name === "__root__" || !mesh.isEnabled()) continue;
    if (typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() === 0) continue;
    names.add(mesh.name);
  }
  return names.size;
}

function stageRemoval(nodeId: string, meshName: string): void {
  let removed = state.pendingPartRemovals.get(nodeId);
  if (!removed) {
    removed = new Set();
    state.pendingPartRemovals.set(nodeId, removed);
  }
  removed.add(meshName);
  setPartVisible(nodeId, meshName, false);
  notifyPendingEditsChanged();
  emit(EVENTS.NODE_LIST_CHANGED, { nodeIds: [nodeId] });
}

function restorePart(nodeId: string, meshName: string): void {
  const removed = state.pendingPartRemovals.get(nodeId);
  removed?.delete(meshName);
  if (removed?.size === 0) state.pendingPartRemovals.delete(nodeId);
  setPartVisible(nodeId, meshName, true);
  notifyPendingEditsChanged();
  emit(EVENTS.NODE_LIST_CHANGED, { nodeIds: [nodeId] });
}

/** Whether the engine's current selection is a part that may be removed. */
export function canRemoveSelectedPart(): boolean {
  const nodeId = state.highlightedNodeId;
  return Boolean(
    nodeId &&
      state.highlightedSubMeshName &&
      state.selectedNodeIds.size === 1 &&
      visiblePartCount(nodeId) > 1,
  );
}

/**
 * Removes the selected part, leaving its model selected.
 * @returns false when no removable part is selected (nothing happened)
 */
export function removeSelectedPart(): boolean {
  if (!canRemoveSelectedPart()) return false;
  const nodeId = state.highlightedNodeId as string;
  const meshName = state.highlightedSubMeshName as string;
  stageRemoval(nodeId, meshName);
  pushUndoEntry({
    type: "part",
    label: "Remove part",
    items: [{ nodeId, meshName, before: true, after: false }],
  });
  selectNode(nodeId);
  return true;
}

// Undo restores the part; redo removes it again.
registerUndoApplier("part", (item, direction) => {
  if (!item.meshName) return;
  if (direction === "before") restorePart(item.nodeId, item.meshName);
  else stageRemoval(item.nodeId, item.meshName);
});
