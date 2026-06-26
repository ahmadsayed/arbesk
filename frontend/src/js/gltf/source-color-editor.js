// @ts-nocheck
/**
 * Direct Source Color Editor
 *
 * Edits per-component colors directly inside a monolithic glTF/GLB source asset.
 * No post-processor overrides - the color is baked into the source CID.
 */

import { getFromRemoteIPFS, getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { isGLB, decomposeGLB } from "./glb-parser.js";

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
 * @param {object} gltf - glTF JSON object (mutated in place)
 * @param {object} nodeColors - { "nodeName": "#RRGGBB", ... }
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
 * The stored result is always glTF JSON: GLB sources are decomposed into a
 * composite glTF first (colors live in JSON, so we never re-serialize back to
 * GLB). The returned `format`/`path` let the caller keep the manifest node in
 * sync - a node whose source was a GLB must stop claiming `format: "glb"` once
 * its content is glTF JSON, or the loader picks the binary-GLB path and fails.
 *
 * @param {string} sourceCid - Current source CID
 * @param {object} nodeColors - { "nodeName": "#RRGGBB", ... }
 * @param {object} [options] - Optional parameters
 * @param {string} [options.assetName] - Asset name for IPFS filename
 * @param {string} [options.assetId] - Asset ID for IPFS filename
 * @returns {Promise<{sourceCid: string, format?: string, path?: string, modified: number, skipped: number}>}
 */
export async function editSourceColors(sourceCid, nodeColors, options = {}) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid) throw new Error("editSourceColors: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf = null;
  let decomposedFromGlb = false;

  try {
    const buffer = await getArrayBufferFromRemoteIPFS(sourceCid);
    if (isGLB(buffer)) {
      // Decompose GLB into composite glTF before editing. Colors live in JSON,
      // so we never need to re-serialize back to GLB for storage. Skip storing
      // the intermediate composite - we write the edited version below.
      const { composite } = await decomposeGLB(buffer, undefined, {
        storeComposite: false,
        dedupMap,
      });
      gltf = composite;
      decomposedFromGlb = true;
    } else {
      gltf = await getFromRemoteIPFS(sourceCid);
    }
  } catch (err) {
    console.warn(`[SRC-COLOR] failed to fetch ${sourceCid}: ${err.message}`);
    throw err;
  }

  const stats = applyNodeColors(gltf, nodeColors);

  const newCid = await writeJSONToIPFS(gltf, null, {
    compress: true,
    assetId,
    filename: assetName || assetId ? `${assetName || assetId}_colored.gltf` : undefined,
  });

  console.log(`[SRC-COLOR] source ${sourceCid} → ${newCid} | modified=${stats.modified} skipped=${stats.skipped}`);

  // Stored content is always glTF JSON now. Signal the format so the caller can
  // correct a node that was previously a GLB; only set the composite path when
  // we actually decomposed a GLB (don't clobber an existing glTF source's path).
  const result = { sourceCid: newCid, format: "gltf", ...stats };
  if (decomposedFromGlb) result.path = "composite.gltf";
  return result;
}
