/**
 * Direct Source Color Editor
 *
 * Edits per-component colors directly inside a monolithic glTF/GLB source asset.
 * No post-processor overrides — the color is baked into the source CID.
 */

import { getFromRemoteIPFS, getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeJSONToIPFS, writeToIPFS } from "../ipfs/write-to-ipfs.js";
import { isGLB, parseGLB, serializeGLB } from "./glb-parser.js";

const IPFS_URI_PREFIX = "ipfs://";

/**
 * Convert a hex color string to a glTF baseColorFactor RGBA array.
 */
function hexToBaseColorFactor(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16) / 255,
    parseInt(clean.substring(2, 4), 16) / 255,
    parseInt(clean.substring(4, 6), 16) / 255,
    1.0,
  ];
}

/**
 * Find every (node, primitive, materialIndex) tuple that belongs to a named node.
 */
function findNodeMaterials(gltf, nodeName) {
  const matches = [];
  if (!gltf.nodes || !gltf.meshes) return matches;

  for (let ni = 0; ni < gltf.nodes.length; ni++) {
    const node = gltf.nodes[ni];
    if (!node.name || node.name.toLowerCase() !== nodeName.toLowerCase()) continue;
    if (node.mesh === undefined || node.mesh === null) continue;

    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) continue;

    for (let pi = 0; pi < mesh.primitives.length; pi++) {
      const prim = mesh.primitives[pi];
      if (prim.material === undefined || prim.material === null) continue;
      matches.push({ nodeIndex: ni, primitiveIndex: pi, materialIndex: prim.material });
    }
  }
  return matches;
}

/**
 * Clone a material and update all relevant primitive references so a color edit
 * only affects the intended nodes, not every node sharing the material.
 */
function ensureUniqueMaterialForNodes(gltf, matches, newMaterialName) {
  if (matches.length === 0) return;

  const targetMaterialIndex = matches[0].materialIndex;
  const usedByOthers = gltf.nodes.some((node, ni) => {
    if (node.mesh === undefined || node.mesh === null) return false;
    const mesh = gltf.meshes[node.mesh];
    if (!mesh || !mesh.primitives) return false;
    return mesh.primitives.some((prim, pi) => {
      const isTarget = matches.some(
        (m) => m.nodeIndex === ni && m.primitiveIndex === pi
      );
      return !isTarget && prim.material === targetMaterialIndex;
    });
  });

  if (!usedByOthers) return; // already unique

  const original = gltf.materials[targetMaterialIndex];
  if (!original) return;

  const clone = JSON.parse(JSON.stringify(original));
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
 * @param {object} gltf — glTF JSON object (mutated in place)
 * @param {object} nodeColors — { "nodeName": "#RRGGBB", ... }
 * @returns {{ modified: number, skipped: number }}
 */
export function applyNodeColors(gltf, nodeColors) {
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
    const seenMaterials = new Set();
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
 * Edit colors in a source asset (glTF JSON or GLB) and upload the new asset.
 *
 * @param {string} sourceCid — Current source CID
 * @param {object} nodeColors — { "nodeName": "#RRGGBB", ... }
 * @returns {Promise<{sourceCid: string, modified: number, skipped: number}>}
 */
export async function editSourceColors(sourceCid, nodeColors) {
  if (!sourceCid) throw new Error("editSourceColors: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf = null;
  let binaryChunk = null;
  let isGlb = false;

  try {
    const buffer = await getArrayBufferFromRemoteIPFS(sourceCid);
    if (isGLB(buffer)) {
      const parsed = parseGLB(buffer);
      gltf = parsed.json;
      binaryChunk = parsed.binaryChunk;
      isGlb = true;
    } else {
      gltf = await getFromRemoteIPFS(sourceCid);
    }
  } catch (err) {
    console.warn(`[SRC-COLOR] failed to fetch ${sourceCid}: ${err.message}`);
    throw err;
  }

  const stats = applyNodeColors(gltf, nodeColors);

  let newCid;
  if (isGlb) {
    const newBuffer = serializeGLB(gltf, binaryChunk);
    newCid = await writeToIPFS(newBuffer, "asset.glb");
  } else {
    newCid = await writeJSONToIPFS(gltf);
  }

  console.log(`[SRC-COLOR] source ${sourceCid} → ${newCid} | modified=${stats.modified} skipped=${stats.skipped}`);
  return { sourceCid: newCid, ...stats };
}
