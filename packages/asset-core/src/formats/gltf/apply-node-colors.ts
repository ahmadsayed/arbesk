/**
 * Per-node material color baking on a glTF JSON document.
 *
 * Pure module: no IPFS, no runtime ports, no @gltf-transform — safe to import
 * from the Web Worker (no import map there, so bare specifiers are off
 * limits). source-color-editor.ts builds on this for the IPFS-backed edit
 * flow; the worker calls applyNodeColors directly for the bake op.
 */

/**
 * Convert a hex color string to a glTF baseColorFactor RGBA array.
 */
function hexToBaseColorFactor(hex: string): number[] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
    1.0,
  ];
}

interface NodeMaterialMatch {
  nodeIndex: number;
  primitiveIndex: number;
  materialIndex: number;
}

/** Collect the (primitive, materialIndex) pairs of one node's mesh. */
function collectNodeMeshMaterials(
  gltf: any,
  nodeIndex: number,
  matches: NodeMaterialMatch[]
): void {
  const node = gltf.nodes[nodeIndex];
  if (node.mesh === undefined || node.mesh === null) return;
  const mesh = gltf.meshes[node.mesh];
  if (!mesh || !mesh.primitives) return;

  for (let pi = 0; pi < mesh.primitives.length; pi++) {
    const prim = mesh.primitives[pi];
    if (prim.material === undefined || prim.material === null) continue;
    matches.push({ nodeIndex, primitiveIndex: pi, materialIndex: prim.material });
  }
}

/**
 * Find every (node, primitive, materialIndex) tuple that belongs to a named node.
 * @param gltf - glTF JSON object (dynamic schema)
 */
function findNodeMaterials(gltf: any, nodeName: string): NodeMaterialMatch[] {
  const matches: NodeMaterialMatch[] = [];
  if (!gltf.nodes || !gltf.meshes) return matches;

  for (let ni = 0; ni < gltf.nodes.length; ni++) {
    const node = gltf.nodes[ni];
    if (!node.name || node.name.toLowerCase() !== nodeName.toLowerCase()) continue;
    collectNodeMeshMaterials(gltf, ni, matches);
  }
  return matches;
}

/**
 * Clone a material and update all relevant primitive references so a color edit
 * only affects the intended nodes, not every node sharing the material.
 * @param gltf - glTF JSON object (mutated in place; dynamic schema)
 */
function ensureUniqueMaterialForNodes(
  gltf: any,
  matches: NodeMaterialMatch[],
  newMaterialName: string
): void {
  if (matches.length === 0) return;

  const targetMaterialIndex = matches[0].materialIndex;
  const usedByOthers = gltf.nodes.some((node: any, ni: number) => {
    if (node.mesh === undefined || node.mesh === null) return false;
    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) return false;
    return mesh.primitives.some((prim: any, pi: number) => {
      const isTarget = matches.some(
        (m) => m.nodeIndex === ni && m.primitiveIndex === pi
      );
      return !isTarget && prim.material === targetMaterialIndex;
    });
  });

  if (!usedByOthers) return; // already unique

  const original = gltf.materials[targetMaterialIndex];
  if (!original) return;

  const clone = structuredClone(original);
  clone.name = newMaterialName;
  const cloneIndex = gltf.materials.length;
  gltf.materials.push(clone);

  for (const match of matches) {
    gltf.meshes[gltf.nodes[match.nodeIndex].mesh].primitives[
      match.primitiveIndex
    ].material = cloneIndex;
    match.materialIndex = cloneIndex;
  }
}

/**
 * Apply color edits directly to a glTF JSON object.
 *
 * @param gltf - glTF JSON object (mutated in place; dynamic schema)
 * @param nodeColors - { "nodeName": "#RRGGBB", ... }
 */
export function applyNodeColors(
  gltf: any,
  nodeColors: Record<string, string>
): { modified: number; skipped: number } {
  let modified = 0;
  let skipped = 0;

  if (!gltf.materials) gltf.materials = [];

  for (const [nodeName, color] of Object.entries(nodeColors)) {
    const matches = findNodeMaterials(gltf, nodeName);
    if (matches.length === 0) {
      console.warn(`[SRC-COLOR] node "${nodeName}" not found in source`);
      skipped++;
      continue;
    }

    ensureUniqueMaterialForNodes(gltf, matches, `${nodeName}_color`);

    const factor = hexToBaseColorFactor(color);
    const seenMaterials = new Set<number>();
    for (const match of matches) {
      if (seenMaterials.has(match.materialIndex)) continue;
      seenMaterials.add(match.materialIndex);

      const mat = gltf.materials[match.materialIndex];
      if (!mat) continue;
      mat.pbrMetallicRoughness ||= {};
      mat.pbrMetallicRoughness.baseColorFactor = factor;
      console.log(
        `[SRC-COLOR] node "${nodeName}" material ${match.materialIndex} → ${color}`
      );
    }
    modified++;
  }

  return { modified, skipped };
}

/**
 * The bakeSourceColors executor op, shared by the Web Worker and the inline
 * (same-thread) executor: validate the payload, deep-copy the glTF document,
 * bake the colors into the copy.
 */
export function bakeSourceColorsOp(payload: any): {
  bakedJson: any;
  modified: number;
  skipped: number;
} {
  const { gltfJson, nodeColors } = payload || {};
  if (!gltfJson) throw new Error("bakeSourceColors: gltfJson is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { bakedJson: gltfJson, modified: 0, skipped: 0 };
  }
  const bakedJson = JSON.parse(JSON.stringify(gltfJson));
  const { modified, skipped } = applyNodeColors(bakedJson, nodeColors);
  return { bakedJson, modified, skipped };
}
