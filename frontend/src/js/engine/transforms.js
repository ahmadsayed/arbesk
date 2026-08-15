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
 * @param {string|{cid: string}} src
 * @returns {string}
 */
export function extractCid(src) {
  if (src && typeof src === "object" && src.cid) {
    return src.cid;
  }
  return /** @type {string} */ (src);
}

export { detectAssetFormat } from "../formats/registry.js";

/**
 * Safely access manifest scene nodes.
 * @param {any} manifest
 * @returns {any[]}
 */
export function getManifestNodes(manifest) {
  return manifest?.scene?.nodes || [];
}

/**
 * Apply a 4x4 column-major transform matrix to a mesh or transform node.
 * @param {BABYLON.TransformNode|BABYLON.AbstractMesh} meshOrNode
 * @param {number[]} matrixArray
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
 * Read the current local transform of one node anchor as a 16-element
 * column-major matrix — the same shape as the manifest `transform_matrix`
 * consumed by `applyTransformMatrix()`. Used by `stageNodeTransform()` and by
 * undo capture sites that snapshot a node's TRS before/after a gesture.
 *
 * Returns null when the anchor is missing or disposed.
 * @param {string} nodeId
 * @returns {number[]|null}
 */
export function readNodeTransformMatrix(nodeId) {
  const anchor = state.nodeAnchors.get(nodeId);
  if (!anchor || anchor.isDisposed()) return null;

  const rotation =
    anchor.rotationQuaternion ||
    // Anchors created before the quaternion seeding (or written via the
    // gizmo's Euler fallback) carry their rotation in `rotation` instead.
    BABYLON.Quaternion.FromEulerVector(anchor.rotation);
  const matrix = BABYLON.Matrix.Compose(
    anchor.scaling,
    rotation,
    anchor.position
  );
  return Array.from(matrix.m);
}

/**
 * Compare two 16-element transform matrices with an absolute epsilon, used to
 * skip no-op undo entries (click-without-drag, unchanged inspector value).
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} [eps]
 */
export function matricesEqual(a, b, eps = 1e-6) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

/**
 * Read the current local transform of one node anchor and stage it for
 * persistence in the manifest (`transform_matrix`). Shared by the viewport
 * gizmo (drag end) and the inspector scale fields.
 *
 * Returns true when a transform was staged.
 * @param {string} nodeId
 * @returns {boolean}
 */
export function stageNodeTransform(nodeId) {
  const matrix = readNodeTransformMatrix(nodeId);
  if (!matrix) return false;
  state.pendingTransformEdits.set(nodeId, matrix);
  return true;
}

/**
 * Apply default light wooden material to meshes.
 * @param {BABYLON.AbstractMesh[]} meshes
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
 * @param {BABYLON.AbstractMesh[]} meshes
 * @returns {BABYLON.AbstractMesh[]}
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
 * @param {BABYLON.AbstractMesh[]} meshes
 * @returns {{min: BABYLON.Vector3, max: BABYLON.Vector3, center: BABYLON.Vector3, size: BABYLON.Vector3}|null}
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
      // Skinned meshes: the mesh node's transform can diverge from where the
      // skeleton actually renders the geometry (Tripo rigged GLBs parent the
      // mesh under a half-height Armature offset), so raw geometry bounds
      // land half a body above the visible model. Apply the skeleton (and
      // morphs) so bounds track the rendered pose.
      mesh.refreshBoundingInfo(
        Boolean(mesh.skeleton),
        Boolean(mesh.morphTargetManager)
      );
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
 * @param {BABYLON.AbstractMesh[]} meshes
 * @param {Array<BABYLON.TransformNode|BABYLON.AbstractMesh>} importedNodes
 * @param {BABYLON.TransformNode} parentNode
 * @param {string} nodeId
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
