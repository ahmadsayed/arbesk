/**
 * Arbesk Scene Graph — Cleanup
 *
 * Scene and node disposal logic. Ensures all Babylon.js resources
 * are properly released when clearing the scene or removing nodes.
 */

import { emit, EVENTS } from "../events/bus.js";
import { state } from "./state.js";
import { setActiveManifestCid, clearAssetManifestCids } from "../domain/asset.js";
import { uiState } from "../state/ui-state.js";

export function clearPendingChildRefs() {
  state.pendingChildRefs.length = 0;
}

export function getPendingChildRefs() {
  return state.pendingChildRefs;
}

/**
 * Pending post-processor edits (color/scale/meshOverrides) accumulated
 * in the inspector. Mirrors `getPendingChildRefs` / `clearPendingChildRefs`
 * so that Save Draft / Publish can pick both up in one pass.
 */
export function getPendingPostProcessorEdits() {
  return state.pendingPostProcessorEdits;
}

export function clearPendingPostProcessorEdits() {
  state.pendingPostProcessorEdits.clear();
}

/**
 * @param {string} nodeId
 */
export function clearPendingPostProcessorEdit(nodeId) {
  state.pendingPostProcessorEdits.delete(nodeId);
}

export function getPendingTransformEdits() {
  return state.pendingTransformEdits;
}

export function clearPendingTransformEdits() {
  state.pendingTransformEdits.clear();
}

/**
 * @param {string} nodeId
 */
export function clearPendingTransformEdit(nodeId) {
  state.pendingTransformEdits.delete(nodeId);
}

export function getPendingSourceOverrides() {
  return state.pendingSourceOverrides;
}

export function clearPendingSourceOverrides() {
  state.pendingSourceOverrides.clear();
}

/**
 * @param {string} nodeId
 * @param {{source: {cid: string, path: string, format: string}, name: string}} entry
 */
export function stagePendingSourceOverride(nodeId, entry) {
  state.pendingSourceOverrides.set(nodeId, entry);
}

/**
 * @param {string} nodeId
 */
export function clearPendingSourceOverride(nodeId) {
  state.pendingSourceOverrides.delete(nodeId);
}

/**
 * Dispose a node's meshes and animation groups while KEEPING its anchor —
 * the anchor carries the node's transform and parent linkage. Used by the
 * viewport file-drop override, which swaps a node's model in place.
 * @param {string} nodeId
 */
export function disposeNodeContent(nodeId) {
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
 * Dispose all meshes and anchors for a single node.
 * @param {string} nodeId
 */
export function disposeNode(nodeId) {
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
  state.pendingPostProcessorEdits.clear();
  state.pendingTransformEdits.clear();
  state.pendingSourceOverrides.clear();

  // Invalidate cached mesh filter
  state._nonChromeMeshCache = null;

  // Clear selection highlight state
  state.highlightedNodeId = null;
  state.selectedNodeIds.clear();
}
