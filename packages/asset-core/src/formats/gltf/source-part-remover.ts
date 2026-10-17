/**
 * Removes named parts (glTF nodes) from a monolithic glTF/GLB source asset.
 * @remarks The Studio's "Remove part" stages a sub-mesh by its Babylon mesh
 *   name, which is the glTF node name (plus a `_primitiveN` suffix on
 *   multi-primitive meshes). Like source-color-editor.ts, the result is
 *   stored as glTF JSON under a new CID. Removed nodes are only unlinked from
 *   the scene graph — their mesh/buffer data stays (orphaned, never rendered),
 *   so no buffer is re-uploaded and the previous version still has the part.
 */

import { getRuntime } from "../../runtime.ts";
import { loadSourceGltf } from "./source-gltf.ts";

/** Babylon mesh name → the glTF node name it was created from. */
export function gltfNodeNameForMesh(meshName: string): string {
  return meshName.replace(/_primitive\d+$/, "");
}

/**
 * Unlinks every node named in `names` from the scenes and from parent nodes.
 * @returns how many nodes were unlinked
 */
export function removeNodesByName(gltf: any, names: Iterable<string>): number {
  const wanted = new Set([...names].map(gltfNodeNameForMesh));
  const nodes: any[] = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
  const doomed = new Set<number>();
  nodes.forEach((node, index) => {
    if (node?.name && wanted.has(node.name)) doomed.add(index);
  });
  if (doomed.size === 0) return 0;
  const keep = (index: number) => !doomed.has(index);
  for (const scene of gltf.scenes || []) {
    if (Array.isArray(scene.nodes)) scene.nodes = scene.nodes.filter(keep);
  }
  for (const node of nodes) {
    if (Array.isArray(node?.children)) node.children = node.children.filter(keep);
  }
  return doomed.size;
}

/**
 * Removes parts from a source asset (glTF JSON or GLB) and uploads the result.
 * @returns the new source CID; `format`/`path` keep the manifest node truthful
 *   when a GLB source becomes composite glTF JSON
 */
export async function removeSourceParts(
  sourceCid: string,
  partNames: string[],
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null } = {},
): Promise<{ sourceCid: string; format?: string; path?: string; removed: number }> {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid) throw new Error("removeSourceParts: sourceCid is required");
  if (partNames.length === 0) return { sourceCid, removed: 0 };

  const { gltf, decomposedFromGlb } = await loadSourceGltf(sourceCid, dedupMap);

  const removed = removeNodesByName(gltf, partNames);
  if (removed === 0) return { sourceCid, removed: 0 };

  const newCid = await getRuntime().ipfsWrite.writeJSON(gltf, null, {
    compress: true,
    assetId,
    filename: assetName || assetId ? `${assetName || assetId}_parts.gltf` : undefined,
  });
  console.log(`[SRC-PARTS] source ${sourceCid} → ${newCid} | removed=${removed}`);

  const result: { sourceCid: string; format?: string; path?: string; removed: number } =
    { sourceCid: newCid, format: "gltf", removed };
  if (decomposedFromGlb) result.path = "composite.gltf";
  return result;
}
