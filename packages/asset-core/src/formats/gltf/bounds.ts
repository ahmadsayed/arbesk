/**
 * Mesh-bounds helpers for glTF/GLB assets.
 * @remarks Pure over the glTF JSON — POSITION accessors carry min/max, so
 *   buffer payloads are never read. Bounds feed a post_processor scale that
 *   compensates Tripo follow-up endpoints (rig, retarget) re-normalizing
 *   model size, keeping each version visually consistent with the chain.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"

export interface GltfBounds {
  min: number[];
  max: number[];
  size: number[];
}

/**
 * Unions the min/max of every mesh POSITION accessor in a glTF document.
 * @remarks Only accessors referenced as `attributes.POSITION` count — normals
 *   and other VEC3 data would skew the result.
 */
export function computeGltfBounds(gltf: any): GltfBounds | null {
  const positionIndices = new Set<number>();
  for (const mesh of gltf?.meshes || []) {
    for (const prim of mesh?.primitives || []) {
      const idx = prim?.attributes?.POSITION;
      if (typeof idx === "number") positionIndices.add(idx);
    }
  }
  let min: number[] | null = null;
  let max: number[] | null = null;
  for (const idx of positionIndices) {
    const acc = gltf.accessors?.[idx];
    if (!acc?.min || !acc?.max) continue;
    if (!min || !max) {
      min = [...acc.min];
      max = [...acc.max];
      continue;
    }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], acc.min[k]);
      max[k] = Math.max(max[k], acc.max[k]);
    }
  }
  if (!min || !max) return null;
  return { min, max, size: min.map((v, k) => max[k] - v) };
}

/**
 * Computes mesh bounds from GLB bytes, returning null for non-GLB v2 bytes.
 */
export function boundsFromGlbBytes(
  bytes: Uint8Array | ArrayBuffer
): GltfBounds | null {
  const buf = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (!buf || buf.length < 20) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  const jsonLen = view.getUint32(12, true);
  try {
    const jsonText = new TextDecoder().decode(buf.subarray(20, 20 + jsonLen));
    return computeGltfBounds(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

/**
 * Computes the uniform scale factor that makes resultBounds match
 * sourceBounds.
 * @remarks Returns null when either side is missing or degenerate, when the
 *   ratio is within 2% of 1 (float noise), or outside [0.01, 100] (guards
 *   against garbage measurements).
 */
export function compensationScale(
  sourceBounds: { size: number[] } | null,
  resultBounds: { size: number[] } | null
): number | null {
  if (!sourceBounds || !resultBounds) return null;
  const source = Math.max(...sourceBounds.size);
  const result = Math.max(...resultBounds.size);
  if (!(source > 0) || !(result > 0)) return null;
  const ratio = source / result;
  if (!Number.isFinite(ratio)) return null;
  if (Math.abs(ratio - 1) < 0.02) return null;
  if (ratio < 0.01 || ratio > 100) return null;
  return ratio;
}
