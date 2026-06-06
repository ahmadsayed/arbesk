/**
 * Arbesk Time-Travel Engine
 *
 * Walks the manifest chain (prev_asset_manifest_cid links) to reconstruct
 * per-node state history. Applies color/scale from any historical manifest
 * version to the current scene meshes.
 *
 * No more variants array — current state lives directly on each node
 * (color, scale, source). History is the manifest chain.
 */

import { getNodeMeshes } from "./scene-graph.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

// Cache of manifest chain versions for each starting CID
const chainCache = new Map();

/**
 * Apply a color to meshes.
 */
function applyColor(meshes, colorHex, meshOverrides = null) {
  if (!colorHex && !meshOverrides) return;
  const defaultColor = colorHex ? BABYLON.Color3.FromHexString(colorHex) : null;

  for (const mesh of meshes) {
    // Determine the effective color for this mesh:
    // meshOverrides take precedence, then fall back to the node default.
    let effectiveColor = defaultColor;
    if (meshOverrides && mesh.name && meshOverrides[mesh.name]?.color) {
      effectiveColor = BABYLON.Color3.FromHexString(
        meshOverrides[mesh.name].color
      );
    }

    if (!effectiveColor) continue;

    if (mesh.material) {
      if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = effectiveColor;
      } else if (mesh.material.albedoColor) {
        mesh.material.albedoColor = effectiveColor;
      }
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor) mat.diffuseColor = effectiveColor;
          else if (mat.albedoColor) mat.albedoColor = effectiveColor;
        }
      }
    }
    for (const child of mesh.getChildMeshes()) {
      applyColor([child], colorHex, meshOverrides);
    }
  }
}

/**
 * Apply scale to meshes.
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
 * Walk the manifest chain from a CID backward through prev_asset_manifest_cid.
 * Returns an array of { cid, version, color, scale, sourceCid } in chronological order.
 *
 * @param {string} startCid - The latest manifest CID to start walking from
 * @param {number} maxDepth - Maximum chain depth to traverse
 * @returns {Promise<Array<{cid: string, version: number, color: string|null, scale: object, sourceCid: string|null}>>}
 */
async function walkManifestChain(startCid, maxDepth = 50) {
  // Check cache first
  const cached = chainCache.get(startCid);
  if (cached) return cached;

  const chain = [];
  let cid = startCid;

  while (cid && chain.length < maxDepth) {
    try {
      const manifest = await getFromRemoteIPFS(cid);
      const nodes = manifest.scene?.nodes || [];
      const firstNode = nodes[0] || {};

      chain.unshift({
        cid,
        version: manifest.version || 0,
        color: firstNode.post_processor?.color || null,
        scale: firstNode.post_processor?.scale || { x: 1, y: 1, z: 1 },
        sourceCid: firstNode.source?.cid || null,
      });

      cid = manifest.prev_asset_manifest_cid || null;
    } catch (err) {
      console.warn(
        `[TIME] walkManifestChain failed at cid=${cid}:`,
        err.message
      );
      break;
    }
  }

  // Cache the result
  chainCache.set(startCid, chain);
  return chain;
}

/**
 * Apply a specific manifest version's state to a node's meshes.
 * Fetches the manifest at manifestCid, finds the node by nodeId,
 * and applies its color + scale to the current scene meshes.
 *
 * @param {string} nodeId - The node to update
 * @param {string} manifestCid - The CID of the manifest version to apply
 */
async function applyManifestVersion(nodeId, manifestCid) {
  const manifest = await getFromRemoteIPFS(manifestCid);
  const node = (manifest.scene?.nodes || []).find((n) => n.node_id === nodeId);
  if (!node) {
    console.warn(`[TIME] node ${nodeId} not found in manifest ${manifestCid}`);
    return;
  }

  const pp = node.post_processor;
  const meshes = getNodeMeshes(nodeId);
  if (meshes) {
    applyColor(meshes, pp?.color, pp?.meshOverrides || null);
    applyScale(meshes, pp?.scale);
  }
}

export { applyColor, applyScale, walkManifestChain, applyManifestVersion };
