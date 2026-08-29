/**
 * Arbesk Child Asset Removal (TODO #18)
 *
 * Unlinks selected child assets (manifest nodes carrying `child_ref`) from the
 * current asset. Mirrors the linked-asset "add" flow: the unlink is staged in
 * memory and persisted on the next Save Draft / Publish. Ctrl/Cmd+Z restores a
 * removed child via the registered "child_ref" undo applier.
 */

import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { state } from "./state.ts";
import { getManifestNodes } from "./transforms.ts";
import { disposeNodeSubtree } from "./cleanup.ts";
import { loadNode } from "./scene-loader.ts";
import { deselectNodes } from "./scene-selection.ts";
import { pushUndoEntry } from "./undo-stack.ts";
import { registerUndoApplier } from "./undo-controller.ts";

/**
 * Pure helper: keep only the selected ids that are child assets. Non-child
 * selections are ignored — removal unlinks child assets, never plain geometry.
 */
export function collectRemovableChildIds(
  selectedIds: Iterable<string>,
  childRefNodeIds: Iterable<string>
): string[] {
  const childSet = new Set(childRefNodeIds);
  return [...selectedIds].filter((id) => childSet.has(id));
}

/** Every node_id in the current asset that is a child asset (child_ref). */
function childRefNodeIds(): Set<string> {
  const ids = new Set<string>();
  for (const n of state.pendingChildRefs) {
    if (n?.child_ref && n.node_id) ids.add(n.node_id);
  }
  for (const n of getManifestNodes(getCurrentManifest()) || []) {
    if (n?.child_ref && n.node_id) ids.add(n.node_id);
  }
  return ids;
}

// In-flight undo reloads keyed by node_id, so a redo can dispose geometry that
// an undo is still (asynchronously) loading.
const _inFlightReloads = new Map<string, Promise<void>>();

function reloadChildAssetNode(node: any): void {
  if (!node?.child_ref) return;
  const parent = state.rootSceneAnchor || state.scene;
  if (!parent) return;
  const p = loadNode(node, parent, 0, new Set())
    .then(() => {
      _inFlightReloads.delete(node.node_id);
    })
    .catch((err) => {
      _inFlightReloads.delete(node.node_id);
      console.warn(
        "[SCENE] failed to reload unlinked child:",
        err?.message || err
      );
    });
  _inFlightReloads.set(node.node_id, p);
}

function unlinkChildAssetNode(
  nodeId: string
): { node: any; fromPending: boolean } | null {
  const pIdx = state.pendingChildRefs.findIndex(
    (n: any) => n?.node_id === nodeId
  );
  if (pIdx >= 0) {
    const [node] = state.pendingChildRefs.splice(pIdx, 1);
    disposeNodeSubtree(nodeId);
    _disposeAfterPendingReload(nodeId);
    return { node, fromPending: true };
  }
  const saved = (getManifestNodes(getCurrentManifest()) || []).find(
    (n: any) => n?.node_id === nodeId && n?.child_ref
  );
  if (saved) {
    // Mark (don't splice) saved children: the save-time no-op diff must still
    // see the baseline, so manifest-builder filters these after snapshotting.
    state.pendingChildRefRemovals.add(nodeId);
    disposeNodeSubtree(nodeId);
    _disposeAfterPendingReload(nodeId);
    return { node: saved, fromPending: false };
  }
  return null;
}

/** If an undo is mid-reload, dispose its geometry once the load settles. */
function _disposeAfterPendingReload(nodeId: string): void {
  const inflight = _inFlightReloads.get(nodeId);
  if (!inflight) return;
  void inflight.then(() => {
    if (_isUnlinked(nodeId)) disposeNodeSubtree(nodeId);
  });
}

function _isUnlinked(nodeId: string): boolean {
  if (state.pendingChildRefRemovals.has(nodeId)) return true;
  return !state.pendingChildRefs.some((n: any) => n?.node_id === nodeId);
}

function reinsertChildAssetNode(captured: {
  node: any;
  fromPending: boolean;
}): void {
  const { node, fromPending } = captured;
  if (!node?.node_id) return;
  if (fromPending) {
    if (!state.pendingChildRefs.some((n: any) => n?.node_id === node.node_id)) {
      state.pendingChildRefs.push(node);
    }
  } else {
    state.pendingChildRefRemovals.delete(node.node_id);
  }
  reloadChildAssetNode(node);
  emit(EVENTS.NODE_LIST_CHANGED, { nodeIds: [node.node_id] });
}

/**
 * Unlink every selected child asset. `nodeIds` defaults to the engine's
 * multi-selection (`state.selectedNodeIds`).
 */
export function removeChildAssetNodes(nodeIds?: Iterable<string>): void {
  const selected = nodeIds ? [...nodeIds] : [...state.selectedNodeIds];
  if (selected.length === 0) return;

  const removable = collectRemovableChildIds(selected, childRefNodeIds());
  if (removable.length === 0) return;

  const items: any[] = [];
  for (const nodeId of removable) {
    const removed = unlinkChildAssetNode(nodeId);
    if (removed) items.push({ nodeId, before: removed, after: null });
  }
  if (items.length === 0) return;

  pushUndoEntry({
    type: "child_ref",
    label: items.length === 1 ? "Unlink child" : "Unlink children",
    items,
  });

  deselectNodes(removable);
  emit(EVENTS.NODE_LIST_CHANGED, { nodeIds: removable });
}

// ── Undo applier ─────────────────────────────────────────────────────────────

registerUndoApplier("child_ref", (item, direction) => {
  const captured = item.before;
  if (!captured?.node) return;
  if (direction === "before") {
    reinsertChildAssetNode(captured);
  } else {
    unlinkChildAssetNode(captured.node.node_id);
    emit(EVENTS.NODE_LIST_CHANGED, { nodeIds: [captured.node.node_id] });
  }
});

// ── Trigger wiring ───────────────────────────────────────────────────────────

on(EVENTS.OUTLINER_REMOVE_REQUESTED, () => {
  removeChildAssetNodes();
});

// Delete / Backspace unlinks the selected child asset(s), Blender-style.
// Guarded against form-field focus so typing never removes geometry.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  const editing =
    el?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
  if (editing) return;
  e.preventDefault();
  removeChildAssetNodes();
});
