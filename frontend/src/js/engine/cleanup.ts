/**
 * Scene and node disposal — ensures all Babylon.js resources are released
 * when clearing the scene or removing nodes.
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "./state.ts";
import type { PendingSourceOverride } from "./state.ts";
import { setActiveManifestCid, clearAssetManifestCids } from "@arbesk/asset-core/domain/asset.js";
import { uiState } from "../state/ui-state.ts";

export function clearPendingChildRefs() {
  state.pendingChildRefs.length = 0;
}

export function getPendingChildRefs() {
  return state.pendingChildRefs;
}

export function getPendingChildRefRemovals() {
  return state.pendingChildRefRemovals;
}

export function clearPendingChildRefRemovals() {
  state.pendingChildRefRemovals.clear();
}

/**
 * Pending post-processor edits (color/scale/meshOverrides).
 */
export function getPendingPostProcessorEdits() {
  return state.pendingPostProcessorEdits;
}

export function clearPendingPostProcessorEdits() {
  state.pendingPostProcessorEdits.clear();
}

export function clearPendingPostProcessorEdit(nodeId: string) {
  state.pendingPostProcessorEdits.delete(nodeId);
}

export function getPendingTransformEdits() {
  return state.pendingTransformEdits;
}

export function clearPendingTransformEdits() {
  state.pendingTransformEdits.clear();
}

export function clearPendingTransformEdit(nodeId: string) {
  state.pendingTransformEdits.delete(nodeId);
}

export function getPendingSourceOverrides() {
  return state.pendingSourceOverrides;
}

export function clearPendingSourceOverrides() {
  state.pendingSourceOverrides.clear();
}

export function stagePendingSourceOverride(
  nodeId: string,
  entry: PendingSourceOverride
) {
  state.pendingSourceOverrides.set(nodeId, entry);
}

export function clearPendingSourceOverride(nodeId: string) {
  state.pendingSourceOverrides.delete(nodeId);
}

/**
 * Disposes a node's meshes and animation groups while keeping its anchor.
 * @remarks The anchor carries the node's transform and parent linkage.
 */
export function disposeNodeContent(nodeId: string) {
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) {
        mesh.dispose();
      }
    }
    state.nodeMeshes.delete(nodeId);
    state._nonChromeMeshCache = null;
  }
  const animationGroups = state.nodeAnimationGroups.get(nodeId);
  if (animationGroups) {
    for (const group of animationGroups) {
      try {
        group.stop();
        if (!group.isDisposed()) group.dispose();
      } catch {
        // ignore — group may already be torn down
      }
    }
    state.nodeAnimationGroups.delete(nodeId);
  }
}

/**
 * Disposes a node and every descendant node it parents.
 * @remarks Descendants are registered under their own node_ids in the state
 *   maps (a child_ref anchor cascades to them), so they are collected and
 *   dropped separately.
 */
export function disposeNodeSubtree(nodeId: string) {
  const top = state.nodeAnchors.get(nodeId);
  const descendantIds: string[] = [];
  if (top && typeof top.getChildren === "function") {
    const stack = [...(top.getChildren() || [])];
    while (stack.length) {
      const child = stack.pop();
      if (!child) continue;
      const childNodeId = child.metadata?.nodeId;
      if (childNodeId && childNodeId !== nodeId) {
        descendantIds.push(childNodeId);
      }
      const kids = child.getChildren?.();
      if (kids?.length) stack.push(...kids);
    }
  }
  // disposeNode disposes the top anchor (Babylon recurses to its children)
  // and removes the top node's meshes/anchor entries.
  disposeNode(nodeId);
  for (const id of descendantIds) {
    state.nodeMeshes.delete(id);
    state.nodeAnchors.delete(id);
    state.nodeAnimationGroups.delete(id);
  }
  state._nonChromeMeshCache = null;
}

/**
 * Dispose all meshes and anchors for a single node.
 */
export function disposeNode(nodeId: string) {
  disposeNodeContent(nodeId);
  const anchor = state.nodeAnchors.get(nodeId);
  if (anchor) {
    if (!anchor.isDisposed()) {
      anchor.dispose();
    }
    state.nodeAnchors.delete(nodeId);
  }
}

/**
 * Clear the entire scene, disposing all meshes, anchors, and imported resources.
 * Keeps the engine running.
 */
export function clearScene() {
  if (!state.scene) {
    setActiveManifestCid(null);
    uiState.set({ selectedNodeId: null });
    return;
  }

  // Detach the transform gizmo before disposing its target node.
  if (state.gizmoManager) {
    try {
      state.gizmoManager.attachToNode(null);
    } catch {
      // ignore
    }
  }

  state.scene.stopAllAnimations();

  // Remove event listeners to prevent memory leaks
  if (state.resizeObserverInstance) {
    state.resizeObserverInstance.disconnect();
    state.resizeObserverInstance = null;
  }

  if (state.resizeEngineHandler) {
    window.removeEventListener("resize", state.resizeEngineHandler);
    state.resizeEngineHandler = null;
  }

  if (state.pointerObservableCallback && state.scene) {
    state.scene.onPointerObservable.remove(
      state.pointerObservableCallback,
      BABYLON.PointerEventTypes.POINTERPICK
    );
    state.pointerObservableCallback = null;
  }

  // Capture the shared material reference so we don't cascade-dispose it
  const sharedMat = state.defaultWoodMaterial;

  state.nodeMeshes.forEach((meshes) => {
    meshes.forEach((mesh) => {
      if (mesh && !mesh.isDisposed()) {
        if (mesh.material && mesh.material !== sharedMat) {
          mesh.dispose(false, true);
        } else {
          mesh.dispose();
        }
      }
    });
  });
  state.nodeMeshes.clear();

  state.nodeAnchors.forEach((anchor) => {
    if (anchor && !anchor.isDisposed()) anchor.dispose();
  });
  state.nodeAnchors.clear();

  state.nodeAnimationGroups.forEach((groups) => {
    groups.forEach((group) => {
      try {
        if (!group.isDisposed()) group.dispose();
      } catch {
        // ignore
      }
    });
  });
  state.nodeAnimationGroups.clear();

  if (state.rootSceneAnchor && !state.rootSceneAnchor.isDisposed()) {
    state.rootSceneAnchor.dispose();
  }
  state.rootSceneAnchor = null;

  [...state.scene.transformNodes].forEach((transformNode) => {
    if (transformNode && !transformNode.isDisposed()) {
      if (transformNode.metadata?.isViewportChrome) return;
      transformNode.dispose();
    }
  });

  [...state.scene.meshes].forEach((mesh) => {
    if (mesh && !mesh.isDisposed()) {
      if (mesh.metadata?.isViewportChrome) return;
      if (mesh.material && mesh.material !== sharedMat) {
        mesh.dispose(false, true);
      } else {
        mesh.dispose();
      }
    }
  });

  if (state.defaultWoodMaterial) {
    try {
      state.defaultWoodMaterial.dispose();
    } catch {
      // ignore
    }
    state.defaultWoodMaterial = null;
  }

  emit(EVENTS.SCENE_CLEARED);

  clearAssetManifestCids();
  uiState.set({ selectedNodeId: null });

  state.pendingChildRefs.length = 0;
  state.pendingChildRefRemovals.clear();
  state.pendingPostProcessorEdits.clear();
  state.pendingTransformEdits.clear();
  state.pendingSourceOverrides.clear();

  // Invalidate cached mesh filter
  state._nonChromeMeshCache = null;

  // Clear selection highlight state
  state.highlightedNodeId = null;
  state.selectedNodeIds.clear();
}
