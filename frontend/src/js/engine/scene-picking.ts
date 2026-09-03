/**
 * Pointer-pick resolution for the Studio viewport.
 * @remarks Pure helpers so the parent-chain walk is independently testable
 *   (no Babylon dependency).
 */

/**
 * Resolves the node identity and boundary for a picked mesh.
 * @remarks Walks the parent chain past the first nodeId to a childRef
 *   boundary (or the chain end); a childRef boundary means the pick is inside
 *   a child asset.
 * @param mesh the picked mesh (or anchor) to walk up from.
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
