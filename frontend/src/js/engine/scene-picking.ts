/**
 * Pointer-pick resolution for the Studio viewport.
 *
 * Pure helpers extracted from scene-graph.ts's pointer-observable callback so
 * the parent-chain walk is independently testable (no Babylon dependency).
 */

/**
 * Resolve the node identity and boundary for a picked mesh by walking the
 * parent chain. Track the first nodeId seen (for regular nodes) but do NOT
 * stop — continue until a childRef boundary is found or the chain ends. A
 * childRef boundary means we are inside a child asset; the parent manifest's
 * node_id is on the outer anchor above it.
 *
 * @param {any} mesh - The picked mesh (or anchor) to walk up from.
 * @returns {{target: any, resolvedNodeId: string|null, isChildAssetNode: boolean}}
 */
export function resolvePickedNodeId(mesh: any) {
  let target = mesh;
  let firstNodeId = null;
  let childAssetNodeId = null;

  while (target) {
    if (target.metadata?.childRef) {
      // childAnchor: its parent is the outer anchor whose metadata.nodeId
      // is the parent-manifest node_id (manifest-loaded path).
      // Fall back to childAnchor's own nodeId for freshly-dropped nodes.
      childAssetNodeId =
        target.parent?.metadata?.nodeId || target.metadata?.nodeId || null;
      break;
    }
    if (target.metadata?.nodeId && !firstNodeId) {
      firstNodeId = target.metadata.nodeId;
    }
    target = target.parent;
  }

  return {
    target,
    resolvedNodeId: childAssetNodeId || firstNodeId,
    isChildAssetNode: !!childAssetNodeId,
  };
}
