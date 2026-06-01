/**
 * Arbesk Time-Travel Engine
 *
 * Maintains per-node version state and allows scrubbing through variant.
 * Generation entries swap geometry; parametric entries apply color/scale overlays.
 * Guarantees temporal isolation: only the target node mutates.
 */

import {
  getNodeAnchor,
  getNodeMeshes,
  disposeNode,
  loadAsset,
  applyTransformMatrix,
} from "./scene-graph.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

/**
 * @typedef {Object} NodeState
 * @property {BABYLON.AbstractMesh[]} meshes
 * @property {number} currentVersionIndex
 * @property {Object[]} variants
 */

/** @type {Map<string, NodeState>} */
const nodeStates = new Map();

/**
 * Register a node's initial state after scene graph load.
 */
function registerNode(nodeId, variants) {
  const meshes = getNodeMeshes(nodeId);
  nodeStates.set(nodeId, {
    meshes,
    currentVersionIndex: variants.length > 0 ? variants.length - 1 : -1,
    variants: variants || [],
  });

  // If the latest variant entry is parametric, apply its overlays to the loaded mesh
  if (variants.length > 0) {
    const latest = variants[variants.length - 1];
    if (latest.type === "parametric" && latest.params) {
      applyParametric(nodeId, latest);
    }
  }
}

/**
 * Get a node's variant array.
 */
function getNodeVariants(nodeId) {
  const state = nodeStates.get(nodeId);
  return state ? state.variants : [];
}

/**
 * Update a node's material color without affecting geometry.
 */
function applyColor(meshes, colorHex) {
  if (!colorHex) return;
  const color = BABYLON.Color3.FromHexString(colorHex);
  for (const mesh of meshes) {
    if (mesh.material) {
      if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = color;
      } else if (mesh.material.albedoColor) {
        mesh.material.albedoColor = color;
      }
      // Also handle multi-materials
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor) mat.diffuseColor = color;
          else if (mat.albedoColor) mat.albedoColor = color;
        }
      }
    }
    // Recurse to children
    for (const child of mesh.getChildMeshes()) {
      applyColor([child], colorHex);
    }
  }
}

/**
 * Update a node's scaling.
 */
function applyScale(meshes, scale) {
  if (!scale) return;
  const s = new BABYLON.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
  for (const mesh of meshes) {
    if (mesh.metadata?.isNodeRoot) {
      mesh.scaling = s;
    }
  }
}

/**
 * Clone transform and metadata from old meshes to new ones.
 */
function preserveMeshState(oldMeshes, newMeshes) {
  if (
    !oldMeshes ||
    oldMeshes.length === 0 ||
    !newMeshes ||
    newMeshes.length === 0
  )
    return;

  const rootOld = oldMeshes.find((m) => m.metadata?.isNodeRoot) || oldMeshes[0];
  const rootNew = newMeshes.find((m) => m.metadata?.isNodeRoot) || newMeshes[0];
  const newMeshMetadata = new Map(
    newMeshes.map((mesh) => [mesh, { ...(mesh.metadata || {}) }])
  );

  if (rootOld && rootNew) {
    if (!rootNew.metadata?.centeringOffset) {
      rootNew.position = rootOld.position.clone();
    }
    rootNew.rotation = rootOld.rotation
      ? rootOld.rotation.clone()
      : BABYLON.Vector3.Zero();
    rootNew.rotationQuaternion = rootOld.rotationQuaternion
      ? rootOld.rotationQuaternion.clone()
      : null;
    rootNew.scaling = rootOld.scaling.clone();
  }

  for (const mesh of newMeshes) {
    mesh.metadata = {
      ...rootOld.metadata,
      ...(newMeshMetadata.get(mesh) || {}),
    };
    mesh.metadata.isNodeRoot = mesh === rootNew;
  }
}

/**
 * Swap a node's geometry to a new version (generation type).
 */
async function swapGeometry(nodeId, entry, anchor) {
  const oldMeshes = getNodeMeshes(nodeId);
  const oldState = nodeStates.get(nodeId);

  // Remove old meshes but keep anchor
  if (oldMeshes) {
    for (const mesh of oldMeshes) {
      mesh.dispose();
    }
  }

  const newMeshes = await loadAsset(
    entry.source,
    anchor,
    nodeId,
    oldState?.variants || []
  );

  preserveMeshState(oldMeshes, newMeshes);

  if (oldState) {
    oldState.meshes = newMeshes;
  }
}

/**
 * Apply parametric overlays (color + scale) without fetching new geometry.
 */
function applyParametric(nodeId, entry) {
  const state = nodeStates.get(nodeId);
  if (!state || !entry.params) return;

  applyColor(state.meshes, entry.params.color);
  applyScale(state.meshes, entry.params.scale);
}

/**
 * Update a node to a specific version index in its variant.
 */
async function updateNodeToVersion(nodeId, targetVersionIndex) {
  const state = nodeStates.get(nodeId);
  if (!state) {
    console.warn(`Node ${nodeId} not registered for time-travel`);
    return;
  }

  const variants = state.variants;
  if (targetVersionIndex < 0 || targetVersionIndex >= variants.length) {
    console.warn(
      `Invalid version index ${targetVersionIndex} for node ${nodeId}`
    );
    return;
  }

  const entry = variants[targetVersionIndex];
  const anchor = getNodeAnchor(nodeId);

  if (entry.type === "generation") {
    await swapGeometry(nodeId, entry, anchor);
  } else if (entry.type === "parametric") {
    // For parametric entries, we start from the most recent generation geometry
    // Find the latest generation before this parametric entry
    let baseGeneration = null;
    for (let i = targetVersionIndex; i >= 0; i--) {
      if (variants[i].type === "generation") {
        baseGeneration = variants[i];
        break;
      }
    }

    // If the current meshes are from a different generation, swap first
    const currentEntry = variants[state.currentVersionIndex];
    const currentIsDifferentGeneration =
      currentEntry &&
      (currentEntry.type !== "generation" ||
        currentEntry.source?.cid !== baseGeneration?.source?.cid);

    if (baseGeneration && currentIsDifferentGeneration) {
      await swapGeometry(nodeId, baseGeneration, anchor);
    }

    applyParametric(nodeId, entry);
  }

  state.currentVersionIndex = targetVersionIndex;

  document.dispatchEvent(
    new CustomEvent("node:versionChanged", {
      detail: { nodeId, versionIndex: targetVersionIndex, entry },
    })
  );
}

/**
 * Append a variant entry to a node's local state (after parametric save).
 */
function appendHistoryEntry(nodeId, entry) {
  const state = nodeStates.get(nodeId);
  if (!state) return;
  state.variants.push(entry);
  state.currentVersionIndex = state.variants.length - 1;
}

/**
 * Listen for scenegraph ready to auto-register nodes.
 */
document.addEventListener("scene:ready", (e) => {
  const manifest = e.detail.manifest;
  if (!manifest.scene?.nodes) return;

  for (const node of manifest.scene?.nodes) {
    registerNode(node.node_id, node.variants || []);
  }
});

export {
  registerNode,
  getNodeVariants,
  updateNodeToVersion,
  appendHistoryEntry,
  applyColor,
  applyScale,
};
