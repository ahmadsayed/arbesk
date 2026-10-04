// ═══════════════════════════════════════════════════════════════════════════
// Group pivot — multi-selection transforms
//
// With 2+ nodes selected the gizmo attaches to a synthetic pivot TransformNode
// at the selection centroid instead of a node anchor. On drag start we
// snapshot each anchor's world matrix relative to the pivot; every frame the
// gizmo moves the pivot we re-derive each anchor's local TRS from the new
// pivot world matrix, so the whole group moves/rotates/scales around the
// shared centroid (Blender "median point" style).
// ═══════════════════════════════════════════════════════════════════════════
import { state } from "./state.ts";

let _groupPivot: BABYLON.TransformNode | null = null;
/**
 * Per-drag snapshot: relative world matrices + parent-space inverses for each
 * selected anchor. Null outside an active group drag.
 */
let _groupSnapshot: Array<{
  anchor: BABYLON.TransformNode;
  rel: BABYLON.Matrix;
  parentInv: BABYLON.Matrix;
}> | null = null;

export function isGroupDragActive(): boolean {
  return _groupSnapshot !== null;
}

export function disposeGroupPivot(): void {
  _groupSnapshot = null;
  if (_groupPivot && !_groupPivot.isDisposed()) {
    _groupPivot.dispose();
  }
  _groupPivot = null;
}

function _ensureGroupPivot(): BABYLON.TransformNode {
  if (_groupPivot && !_groupPivot.isDisposed()) return _groupPivot;
  _groupPivot = new BABYLON.TransformNode("groupTransformPivot", state.scene);
  _groupPivot.rotationQuaternion = BABYLON.Quaternion.Identity();
  return _groupPivot;
}

/**
 * Returns the anchors for `ids` with no other listed anchor in their parent
 * chain.
 * @remarks Transforming both a parent and its nested child in one group drag
 *   would move the child twice, so only the top-most anchors are driven and
 *   nested ones ride along.
 */
export function topLevelAnchorsFor(ids: Iterable<string>): BABYLON.TransformNode[] {
  const anchors = [...ids]
    .map((id) => state.nodeAnchors.get(id))
    .filter((a) => a && !a.isDisposed());
  const set = new Set(anchors);
  return anchors.filter((a) => {
    for (let p = a.parent; p; p = p.parent) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/**
 * Place the pivot at the centroid of the selected anchors' world positions
 * with identity rotation/scale, and attach the gizmo to it.
 */
export function attachToGroupPivot(gizmoManager: BABYLON.GizmoManager): void {
  const anchors = topLevelAnchorsFor(state.selectedNodeIds);
  if (anchors.length === 0) {
    gizmoManager.attachToNode(null);
    return;
  }
  // Selection collapses to a single subtree (e.g. a model plus its own
  // child-asset node): drive that anchor directly, no pivot needed.
  if (anchors.length === 1) {
    gizmoManager.attachToNode(anchors[0]);
    return;
  }

  const pivot = _ensureGroupPivot();
  const centroid = anchors
    .reduce((sum, a) => sum.addInPlace(a.getAbsolutePosition()), BABYLON.Vector3.Zero())
    .scaleInPlace(1 / anchors.length);
  pivot.position.copyFrom(centroid);
  pivot.rotationQuaternion.copyFrom(BABYLON.Quaternion.Identity());
  pivot.scaling.copyFromFloats(1, 1, 1);
  pivot.computeWorldMatrix(true);

  gizmoManager.attachToNode(pivot);
}

export function startGroupDrag(): void {
  if (!_groupPivot || state.selectedNodeIds.size < 2) return;
  const topAnchors = topLevelAnchorsFor(state.selectedNodeIds);
  if (topAnchors.length < 2) return; // gizmo is on the single anchor directly
  _groupPivot.computeWorldMatrix(true);
  const pivotInv = BABYLON.Matrix.Invert(_groupPivot.getWorldMatrix());
  _groupSnapshot = [];
  for (const anchor of topAnchors) {
    anchor.computeWorldMatrix(true);
    // Babylon row-vector convention: A.multiply(B) applies A first, so the
    // anchor-in-pivot-space matrix is anchorWorld × pivotInv — not the reverse.
    // The reversed order makes the pivot's offset pre-multiply the anchor's
    // own scale/rotation (scaled anchors move faster/slower than the gizmo).
    const rel = anchor.getWorldMatrix().multiply(pivotInv);
    const parentWorld = anchor.parent
      ? anchor.parent.getWorldMatrix()
      : BABYLON.Matrix.Identity();
    _groupSnapshot.push({
      anchor,
      rel,
      parentInv: BABYLON.Matrix.Invert(parentWorld),
    });
  }
}

/**
 * Re-derives every grouped anchor's local TRS from the pivot's current world
 * matrix.
 */
export function applyGroupDrag(): void {
  if (!_groupSnapshot || !_groupPivot) return;
  _groupPivot.computeWorldMatrix(true);
  const pivotWorld = _groupPivot.getWorldMatrix();
  const scale = new BABYLON.Vector3();
  const rotation = new BABYLON.Quaternion();
  const position = new BABYLON.Vector3();
  for (const entry of _groupSnapshot) {
    if (entry.anchor.isDisposed()) continue;
    // rel × pivotWorld (apply rel first, then the pivot's new world matrix)
    // — the matching order to the drag-start snapshot above.
    const world = entry.rel.multiply(pivotWorld);
    const local = world.multiply(entry.parentInv);
    if (!local.decompose(scale, rotation, position)) continue;
    entry.anchor.scaling.copyFrom(scale);
    entry.anchor.rotationQuaternion = entry.anchor.rotationQuaternion || new BABYLON.Quaternion();
    entry.anchor.rotationQuaternion.copyFrom(rotation);
    entry.anchor.position.copyFrom(position);
  }
}

export function endGroupDrag(): void {
  _groupSnapshot = null;
}

/** Keeps the pivot glued to its group after the group was grounded. */
export function shiftGroupPivotY(dy: number): void {
  if (_groupPivot && !_groupPivot.isDisposed()) {
    _groupPivot.position.y += dy;
    _groupPivot.computeWorldMatrix(true);
  }
}
