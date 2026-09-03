/**
 * Deterministic model facts extracted from parsed glTF 2.0 JSON.
 * @remarks Pure — no buffer reads; counts come from accessor/mesh metadata.
 *   Counts honor primitive mode and dedup shared accessors.
 */
import { computeGltfBounds } from "./bounds.ts";
import type { GltfBounds } from "./bounds.ts";

export interface ComputedDimensions {
  width: number;
  height: number;
  depth: number;
  unit: string;
}

export interface ComputedMetadata {
  format?: "glb" | "gltf" | "3mf";
  dimensions?: ComputedDimensions;
  bounds?: { min: number[]; max: number[] };
  center?: number[];
  origin?: number[];
  animation_clips?: string[];
  triangle_count?: number;
  vertex_count?: number;
  mesh_count?: number;
  node_count?: number;
  material_count?: number;
  texture_count?: number;
  rigged?: boolean;
  bone_count?: number;
}

/** Root scene's first node translation, defaulting to [0,0,0]. */
function rootTranslation(gltf: any): number[] {
  const sceneIdx = gltf?.scene ?? 0;
  const rootNodeIdx = gltf?.scenes?.[sceneIdx]?.nodes?.[0];
  return gltf?.nodes?.[rootNodeIdx]?.translation ?? [0, 0, 0];
}

/** glTF primitive mode constants (mode omitted ⇒ TRIANGLES = 4). */
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;

/** The accessor whose count drives a primitive's triangle count (index if indexed, else POSITION), or null. */
function countAccessor(prim: any): number | null {
  if (typeof prim.indices === "number") return prim.indices;
  const pos = prim.attributes?.POSITION;
  return typeof pos === "number" ? pos : null;
}

/** Element count (index count if indexed, else POSITION count) for one primitive. */
function primitiveElementCount(gltf: any, prim: any): number {
  const acc = countAccessor(prim);
  return acc === null ? 0 : gltf.accessors?.[acc]?.count ?? 0;
}

/** Triangles contributed by one primitive, honoring its mode. */
function primitiveTriangleCount(gltf: any, prim: any): number {
  const n = primitiveElementCount(gltf, prim);
  const mode = prim.mode ?? TRIANGLES;
  if (mode === TRIANGLES) return Math.floor(n / 3);
  if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) return Math.max(0, n - 2);
  return 0; // POINTS / LINES / LINE_LOOP / LINE_STRIP
}

/** Sum of triangle counts across primitives, deduping shared accessors. */
function triangleCount(gltf: any): number {
  const seen = new Set<number>();
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const acc = countAccessor(prim);
      if (acc === null || seen.has(acc)) continue;
      seen.add(acc);
      total += primitiveTriangleCount(gltf, prim);
    }
  }
  return total;
}

/** Sum of POSITION accessor counts, deduping shared accessors. */
function vertexCount(gltf: any): number {
  const seen = new Set<number>();
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      if (typeof pos !== "number" || seen.has(pos)) continue;
      seen.add(pos);
      total += gltf.accessors?.[pos]?.count ?? 0;
    }
  }
  return total;
}

/** Count of unique joint node indices across all skins. */
function boneCount(gltf: any): number {
  const joints = new Set<number>();
  for (const skin of gltf?.skins ?? []) {
    for (const j of skin?.joints ?? []) joints.add(j);
  }
  return joints.size;
}

/** glTF animations → clip names (unnamed get a stable "clip_<i>"). */
function animationClips(gltf: any): string[] {
  return (gltf?.animations ?? []).map((a: any, i: number) => a?.name || "clip_" + i);
}

export function computeModelStats(
  gltfJson: any,
  opts: { format?: "glb" | "gltf" | "3mf" } = {},
): ComputedMetadata {
  const format = opts.format ?? "gltf";
  const bounds: GltfBounds | null = computeGltfBounds(gltfJson);
  const stats: ComputedMetadata = { format };

  if (bounds) {
    stats.dimensions = {
      width: bounds.size[0],
      height: bounds.size[1],
      depth: bounds.size[2],
      unit: "meters",
    };
    stats.bounds = { min: bounds.min, max: bounds.max };
    stats.center = bounds.min.map((v, k) => (v + bounds.max[k]) / 2);
  }

  // 3MF has no glTF scenes/nodes/animations/skins — bounds + format only.
  if (format !== "3mf") {
    stats.origin = rootTranslation(gltfJson);
    stats.animation_clips = animationClips(gltfJson);
    stats.triangle_count = triangleCount(gltfJson);
    stats.vertex_count = vertexCount(gltfJson);
    stats.mesh_count = gltfJson?.meshes?.length ?? 0;
    stats.node_count = gltfJson?.nodes?.length ?? 0;
    stats.material_count = gltfJson?.materials?.length ?? 0;
    stats.texture_count = gltfJson?.textures?.length ?? 0;
    stats.rigged = (gltfJson?.skins?.length ?? 0) > 0;
    stats.bone_count = boneCount(gltfJson);
  }

  return stats;
}
