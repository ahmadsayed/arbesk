/**
 * Pure placement math for View/Edit mode: selection bounds, floor grounding,
 * reset targets, and snap steps.
 * @remarks No Babylon or DOM access — engine/placement-actions.ts adapts live
 *   anchors to these plain shapes.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Below this, a selection counts as already on the floor. */
export const GROUND_EPS = 1e-6;

/** Rotation gizmo snap: 15°. */
export const ROTATE_SNAP = Math.PI / 12;

/** World size of one ground-grid cell at grid scale 1 (40 units / 20 cells). */
const GRID_CELL = 2;

function _finite(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * True for a finite, non-inverted box.
 * @remarks Babylon reports a mesh-less hierarchy as min = +MAX, max = −MAX.
 */
export function isValidBounds(b: Bounds | null | undefined): b is Bounds {
  if (!b || !_finite(b.min) || !_finite(b.max)) return false;
  return b.min.x <= b.max.x && b.min.y <= b.max.y && b.min.z <= b.max.z;
}

/** Axis-aligned union of the valid boxes; null when none are valid. */
export function boundsUnion(list: Array<Bounds | null>): Bounds | null {
  const valid = list.filter(isValidBounds);
  if (valid.length === 0) return null;
  const min = { ...valid[0].min };
  const max = { ...valid[0].max };
  for (const b of valid.slice(1)) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/** World Y offset that rests the box's lowest point on Y = 0. */
export function groundDelta(b: Bounds | null): number {
  if (!isValidBounds(b)) return 0;
  return Math.abs(b.min.y) < GROUND_EPS ? 0 : -b.min.y;
}

/** World offset that centres the box on X/Z = 0 and grounds it. */
export function resetOffset(b: Bounds | null): Vec3 {
  if (!isValidBounds(b)) return { x: 0, y: 0, z: 0 };
  return {
    x: -(b.min.x + b.max.x) / 2,
    y: groundDelta(b),
    z: -(b.min.z + b.max.z) / 2,
  };
}

/** Move snap distance: one visible grid cell. */
export function moveSnapStep(gridScale: number): number {
  return Number.isFinite(gridScale) && gridScale > 0 ? GRID_CELL * gridScale : GRID_CELL;
}
