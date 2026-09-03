/**
 * Domain: Node — one placement inside an asset's tree.
 * @remarks Pure data mirroring a manifest `scene.nodes[]` entry; engine runtime
 *   objects never live here (the engine keys its maps by nodeId).
 */
import { normalizeAssetRef } from "./asset-ref.ts";
import type { AssetRef } from "./asset-ref.ts";

/**
 * One placement inside an asset's tree.
 */
export interface Node {
  nodeId: string;
  /** 16-element column-major matrix */
  transformMatrix: number[];
  source: { cid: string; path?: string; format?: string } | null;
  ref: AssetRef | null;
  postProcessor: object | null;
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Map one persisted manifest node to a domain Node.
 */
export function manifestNodeToNode(manifestNode: any): Node {
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

export function manifestNodes(manifest: any): Node[] {
  const nodes = manifest?.scene?.nodes;
  return Array.isArray(nodes) ? nodes.map(manifestNodeToNode) : [];
}
