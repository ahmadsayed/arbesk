// @ts-check
/**
 * Domain: Node — one placement inside an asset's tree. Pure data mirroring a
 * manifest `scene.nodes[]` entry. Engine runtime objects (anchors, meshes,
 * animation groups) never live here; the engine keys its maps by nodeId.
 */
import { normalizeAssetRef } from "./asset-ref.js";

/**
 * @typedef {Object} Node
 * @property {string} nodeId
 * @property {number[]} transformMatrix - 16-element column-major matrix
 * @property {{cid: string, path?: string, format?: string}|null} source
 * @property {import("./asset-ref.js").AssetRef|null} ref
 * @property {object|null} postProcessor
 */

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Map one persisted manifest node to a domain Node.
 * @param {any} manifestNode
 * @returns {Node}
 */
export function manifestNodeToNode(manifestNode) {
  return {
    nodeId: String(manifestNode?.node_id ?? ""),
    transformMatrix: Array.isArray(manifestNode?.transform_matrix)
      ? [...manifestNode.transform_matrix]
      : [...IDENTITY_MATRIX],
    source: manifestNode?.source ?? null,
    ref: normalizeAssetRef(manifestNode?.child_ref),
    postProcessor: manifestNode?.post_processor ?? null,
  };
}

/**
 * @param {any} manifest
 * @returns {Node[]}
 */
export function manifestNodes(manifest) {
  const nodes = manifest?.scene?.nodes;
  return Array.isArray(nodes) ? nodes.map(manifestNodeToNode) : [];
}
