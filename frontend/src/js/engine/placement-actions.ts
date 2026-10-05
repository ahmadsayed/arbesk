/**
 * Placement on live anchors: bounds, world-space translation, floor
 * grounding and transform reset.
 * @remarks The math is in placement.ts; callers own undo and staging
 *   (engine/transform-commit.ts). Anchors without hierarchy bounds (test
 *   doubles, the invisible-mesh fallback before load) are skipped.
 */
import { boundsUnion, groundDelta, resetOffset } from "./placement.ts";
import type { Bounds, Vec3 } from "./placement.ts";

function _anchorBounds(anchor: any): Bounds | null {
  if (typeof anchor?.getHierarchyBoundingVectors !== "function") return null;
  anchor.computeWorldMatrix?.(true);
  const { min, max } = anchor.getHierarchyBoundingVectors(true);
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}

/** World AABB over the anchors' whole hierarchies (child assets included). */
export function anchorsBounds(anchors: any[]): Bounds | null {
  return boundsUnion(anchors.map(_anchorBounds));
}

/** Moves an anchor by a world-space offset, expressed in its parent's space. */
export function translateWorld(anchor: any, d: Vec3): void {
  let local = new BABYLON.Vector3(d.x, d.y, d.z);
  if (anchor.parent) {
    const inv = BABYLON.Matrix.Invert(anchor.parent.getWorldMatrix());
    local = BABYLON.Vector3.TransformNormal(local, inv);
  }
  anchor.position.addInPlace(local);
  anchor.computeWorldMatrix?.(true);
}

/**
 * Rests the anchors on Y = 0 as one rigid group (stacking preserved).
 * @returns the world dy applied; 0 when nothing moved.
 */
export function groundAnchors(anchors: any[]): number {
  const dy = groundDelta(anchorsBounds(anchors));
  if (dy === 0) return 0;
  for (const a of anchors) translateWorld(a, { x: 0, y: dy, z: 0 });
  return dy;
}

/**
 * Rotation → identity, then centre on X/Z = 0 and ground. Scale untouched.
 * @remarks Rotation identity is LOCAL: a child of a rotated, unselected parent
 *   keeps the parent's rotation in world space.
 */
export function resetAnchor(anchor: any): void {
  anchor.rotationQuaternion = BABYLON.Quaternion.Identity();
  anchor.computeWorldMatrix?.(true);
  translateWorld(anchor, resetOffset(_anchorBounds(anchor)));
}
