/**
 * Arbesk Scene Graph — Cleanup
 *
 * Scene and node disposal logic. Ensures all Babylon.js resources
 * are properly released when clearing the scene or removing nodes.
 */

import { emit, EVENTS } from "../events/registry.js";
import { state } from "./state.js";

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

export function clearPendingPostProcessorEdit(nodeId) {
  state.pendingPostProcessorEdits.delete(nodeId);
}

/**
 * Dispose all meshes and anchors for a single node.
 */
export function disposeNode(nodeId) {
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) {
        mesh.dispose();
      }
    }
    state.nodeMeshes.delete(nodeId);
  }
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
    window.activeAssetManifestCid = null;
    window.selectedNodeId = null;
    return;
  }

  state.scene.stopAllAnimations();

  // Capture the shared material reference so we don't cascade-dispose it
  const sharedMat = state.defaultWoodMaterial;

  for (const [, meshes] of state.nodeMeshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) {
        // Only cascade-dispose materials that are unique to this import,
        // never the shared defaultWoodMaterial (handled separately below).
        if (mesh.material && mesh.material !== sharedMat) {
          mesh.dispose(false, true);
        } else {
          mesh.dispose();
        }
      }
    }
  }
  state.nodeMeshes.clear();

  for (const [, anchor] of state.nodeAnchors) {
    if (anchor && !anchor.isDisposed()) {
      anchor.dispose();
    }
  }
  state.nodeAnchors.clear();

  if (state.rootSceneAnchor && !state.rootSceneAnchor.isDisposed()) {
    state.rootSceneAnchor.dispose();
  }
  state.rootSceneAnchor = null;

  for (const transformNode of [...state.scene.transformNodes]) {
    if (transformNode && !transformNode.isDisposed()) {
      if (transformNode.metadata?.isViewportChrome) continue;
      transformNode.dispose();
    }
  }

  for (const mesh of [...state.scene.meshes]) {
    if (mesh && !mesh.isDisposed()) {
      if (mesh.metadata?.isViewportChrome) continue;
      if (mesh.material && mesh.material !== sharedMat) {
        mesh.dispose(false, true);
      } else {
        mesh.dispose();
      }
    }
  }

  if (state.defaultWoodMaterial) {
    try {
      state.defaultWoodMaterial.dispose();
    } catch (_) {
      // ignore
    }
    state.defaultWoodMaterial = null;
  }

  emit(EVENTS.SCENE_CLEARED);

  window.activeAssetManifestCid = null;
  window.selectedNodeId = null;
  window.latestAssetManifestCid = null;

  state.pendingChildRefs.length = 0;
  state.pendingPostProcessorEdits.clear();

  // Clear selection highlight state
  state.highlightedNodeId = null;
}
