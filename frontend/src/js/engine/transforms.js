// @ts-nocheck
/**
 * Arbesk Scene Graph - Transforms & Helpers
 *
 * Pure helper functions for CID extraction, format detection,
 * transform matrix application, material defaults, bounding boxes,
 * and manifest node access.
 */

import { DEFAULT_WOOD_COLOR, state } from "./state.js";

/**
 * Extract a CID from a source reference.
 */
export function extractCid(src) {
  if (src && typeof src === "object" && src.cid) {
    return src.cid;
  }
  return src;
}

export { detectAssetFormat } from "../formats/registry.js";

/**
 * Safely access manifest scene nodes.
 */
export function getManifestNodes(manifest) {
  return manifest?.scene?.nodes || [];
}

/**
 * Apply a 4x4 column-major transform matrix to a mesh or transform node.
 */
export function applyTransformMatrix(meshOrNode, matrixArray) {
  if (!matrixArray || matrixArray.length !== 16) return;

  const matrix = BABYLON.Matrix.FromValues(...matrixArray);
  const scale = new BABYLON.Vector3();
  const rotation = new BABYLON.Quaternion();
  const translation = new BABYLON.Vector3();
  matrix.decompose(scale, rotation, translation);

  meshOrNode.scaling = scale;
  meshOrNode.rotationQuaternion = rotation;
  meshOrNode.position = translation;
}

/**
 * Apply default light wooden material to meshes.
 */
export function applyDefaultMaterial(meshes) {
  const woodColor = BABYLON.Color3.FromHexString(DEFAULT_WOOD_COLOR);
  if (!state.defaultWoodMaterial) {
    state.defaultWoodMaterial = new BABYLON.StandardMaterial(
      "defaultWood",
      state.scene
    );
    state.defaultWoodMaterial.diffuseColor = woodColor;
  }
  for (const mesh of meshes) {
    if (mesh.material) {
      if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = woodColor;
      } else if (mesh.material.albedoColor) {
        mesh.material.albedoColor = woodColor;
      }
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor) mat.diffuseColor = woodColor;
          else if (mat.albedoColor) mat.albedoColor = woodColor;
        }
      }
    } else {
      mesh.material = state.defaultWoodMaterial;
    }
  }
}

/**
 * Return renderable meshes that contribute to imported asset bounds.
 */
export function getRenderableMeshes(meshes) {
  return meshes.filter(
    (mesh) =>
      mesh &&
      !mesh.isDisposed() &&
      typeof mesh.getTotalVertices === "function" &&
      mesh.getTotalVertices() > 0
  );
}

/**
 * Compute world-space bounds for a set of renderable meshes.
 */
export function getWorldBounds(meshes) {
  let min = new BABYLON.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  let max = new BABYLON.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  );

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    if (typeof mesh.refreshBoundingInfo === "function") {
      mesh.refreshBoundingInfo();
    }

    const boundingInfo = mesh.getBoundingInfo?.();
    const boundingBox = boundingInfo?.boundingBox;
    if (!boundingBox) continue;

    min = BABYLON.Vector3.Minimize(min, boundingBox.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, boundingBox.maximumWorld);
  }

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;

  const center = min.add(max).scale(0.5);
  const size = max.subtract(min);
  return { min, max, center, size };
}

/**
 * Shift imported root nodes so the asset's bounding-box center sits on its anchor.
 */
export function centerImportedAsset(meshes, importedNodes, parentNode, nodeId) {
  const renderableMeshes = getRenderableMeshes(meshes);
  if (renderableMeshes.length === 0) return;

  const bounds = getWorldBounds(renderableMeshes);
  if (!bounds) return;

  const rootNodes = importedNodes.filter((node) => node?.parent === parentNode);
  if (rootNodes.length === 0) {
    console.warn(
      `[SCENE] unable to center asset nodeId=${nodeId}: no imported root nodes`
    );
    return;
  }

  parentNode.computeWorldMatrix(true);
  const inverseParentWorld = parentNode.getWorldMatrix().clone().invert();
  const localCenter = BABYLON.Vector3.TransformCoordinates(
    bounds.center,
    inverseParentWorld
  );

  if (!Number.isFinite(localCenter.x)) return;

  for (const rootNode of rootNodes) {
    rootNode.position.subtractInPlace(localCenter);
    rootNode.computeWorldMatrix(true);
    rootNode.metadata = rootNode.metadata || {};
    rootNode.metadata.centeringOffset = localCenter.clone();
  }

  console.log(
    `[SCENE] centered asset | nodeId=${nodeId} center=(${bounds.center.x.toFixed(
      3
    )}, ${bounds.center.y.toFixed(3)}, ${bounds.center.z.toFixed(
      3
    )}) size=(${bounds.size.x.toFixed(3)}, ${bounds.size.y.toFixed(
      3
    )}, ${bounds.size.z.toFixed(3)})`
  );
}
