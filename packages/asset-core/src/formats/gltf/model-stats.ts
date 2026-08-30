/**
 * Deterministic model facts extracted from parsed glTF 2.0 JSON.
 * Pure functions — no buffer reads; counts come from accessor/mesh metadata.
 * No heuristics: only values derivable with exact accuracy are computed.
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

/** Sum of triangle counts across primitives (indexed → index.count/3, else POSITION.count/3). */
function triangleCount(gltf: any): number {
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const idx = prim.indices;
      if (typeof idx === "number") {
        total += Math.floor((gltf.accessors?.[idx]?.count ?? 0) / 3);
      } else {
        const pos = prim.attributes?.POSITION;
        if (typeof pos === "number") {
          total += Math.floor((gltf.accessors?.[pos]?.count ?? 0) / 3);
        }
      }
    }
  }
  return total;
}

/** Sum of vertex counts across primitives (POSITION accessor count). */
function vertexCount(gltf: any): number {
  let total = 0;
  for (const mesh of gltf?.meshes ?? []) {
    for (const prim of mesh?.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      if (typeof pos === "number") total += gltf.accessors?.[pos]?.count ?? 0;
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
