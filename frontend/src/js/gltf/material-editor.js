/**
 * Arbesk glTF Material Editor
 *
 * Operates on composite glTF JSON (ipfs:// URI format). Fetches the
 * composite, modifies material properties, and uploads a new composite
 * CID — leaving buffer and image CIDs untouched (IPFS deduplication).
 *
 * Supported edits:
 *   - baseColorFactor (RGBA array)
 *   - metallicFactor
 *   - roughnessFactor
 *   - emissiveFactor (RGB array)
 *   - alphaCutoff
 *   - alphaMode (OPAQUE, MASK, BLEND)
 *   - doubleSided (boolean)
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";

/**
 * Fetch a composite glTF JSON from IPFS by CID.
 *
 * @param {string} compositeCid - IPFS CID of the composite glTF JSON
 * @returns {Promise<object>} Composite glTF JSON
 */
export async function fetchComposite(compositeCid) {
  if (!compositeCid) throw new Error("fetchComposite: compositeCid is required");
  console.log(`[MAT-EDIT] fetching composite | cid=${compositeCid}`);
  const gltf = await getFromRemoteIPFS(compositeCid);

  // Validate it looks like a glTF
  if (!gltf.asset || !gltf.asset.version) {
    throw new Error(`CID ${compositeCid} does not appear to be a glTF file`);
  }

  return gltf;
}

/**
 * Find a material by index in the glTF.
 *
 * @param {object} composite - Composite glTF JSON
 * @param {number} materialIndex - Index into materials array
 * @returns {object} The material object (mutable reference)
 */
export function getMaterial(composite, materialIndex = 0) {
  if (!composite.materials || !composite.materials[materialIndex]) {
    throw new Error(
      `Material index ${materialIndex} not found (total: ${composite.materials?.length || 0})`
    );
  }
  return composite.materials[materialIndex];
}

/**
 * Find a material by mesh primitive reference.
 * Walks meshes to find the material assigned to a specific primitive.
 *
 * @param {object} composite - Composite glTF JSON
 * @param {string} meshName - Name of the mesh to find (e.g., "flowercenter")
 * @returns {{ material: object, meshIndex: number, primitiveIndex: number }|null}
 */
export function findMaterialByMeshName(composite, meshName) {
  if (!composite.meshes || !meshName) return null;

  for (let mi = 0; mi < composite.meshes.length; mi++) {
    const mesh = composite.meshes[mi];
    if (mesh.name !== meshName) continue;

    for (let pi = 0; pi < (mesh.primitives || []).length; pi++) {
      const prim = mesh.primitives[pi];
      if (prim.material === undefined || prim.material === null) continue;

      const mat = composite.materials?.[prim.material];
      if (mat) {
        return {
          material: mat,
          meshIndex: mi,
          primitiveIndex: pi,
        };
      }
    }
  }

  return null;
}

/**
 * Set the base color factor of a PBR material.
 * The factor is multiplied with the base color texture (if any).
 *
 * @param {object} material - The material object to modify
 * @param {number[]|string} color - RGBA array [r,g,b,a] or hex string "#RRGGBB"
 * @returns {object} The modified material (same reference)
 */
export function setBaseColorFactor(material, color) {
  material.pbrMetallicRoughness ||= {};

  let rgba;
  if (typeof color === "string") {
    // Hex string → RGBA
    const hex = color.replace("#", "");
    rgba = [
      parseInt(hex.substring(0, 2), 16) / 255,
      parseInt(hex.substring(2, 4), 16) / 255,
      parseInt(hex.substring(4, 6), 16) / 255,
      1.0,
    ];
  } else if (Array.isArray(color)) {
    rgba = [...color];
  } else {
    throw new Error("setBaseColorFactor: color must be hex string or RGBA array");
  }

  material.pbrMetallicRoughness.baseColorFactor = rgba;
  console.log(`[MAT-EDIT] baseColorFactor → [${rgba.map(v => v.toFixed(3)).join(", ")}]`);
  return material;
}

/**
 * Apply a mesh-override color map to a composite glTF.
 * For each mesh name in overrides, finds its material and sets baseColorFactor.
 *
 * @param {object} composite - Composite glTF JSON
 * @param {object} meshOverrides - { "meshName": { color: "#RRGGBB" }, ... }
 * @param {string} [defaultColor] - Hex color to apply to all materials as baseline
 * @returns {{ modified: number, skipped: number }}
 */
export function applyMeshOverrideColors(composite, meshOverrides, defaultColor = null) {
  if (!meshOverrides) return { modified: 0, skipped: 0 };

  let modified = 0;
  let skipped = 0;

  // Apply default color to all materials first
  if (defaultColor) {
    for (const mat of composite.materials || []) {
      setBaseColorFactor(mat, defaultColor);
    }
  }

  // Apply per-mesh overrides
  for (const [meshName, override] of Object.entries(meshOverrides)) {
    if (!override?.color) continue;

    const result = findMaterialByMeshName(composite, meshName);
    if (result) {
      setBaseColorFactor(result.material, override.color);
      modified++;
      console.log(`[MAT-EDIT] mesh "${meshName}" → ${override.color}`);
    } else {
      skipped++;
      console.warn(`[MAT-EDIT] mesh "${meshName}" not found in composite`);
    }
  }

  console.log(`[MAT-EDIT] applied ${modified} overrides, skipped ${skipped}`);
  return { modified, skipped };
}

/**
 * Set metallic factor.
 */
export function setMetallicFactor(material, value) {
  material.pbrMetallicRoughness ||= {};
  material.pbrMetallicRoughness.metallicFactor = Math.max(0, Math.min(1, value));
  return material;
}

/**
 * Set roughness factor.
 */
export function setRoughnessFactor(material, value) {
  material.pbrMetallicRoughness ||= {};
  material.pbrMetallicRoughness.roughnessFactor = Math.max(0, Math.min(1, value));
  return material;
}

/**
 * Set emissive factor.
 */
export function setEmissiveFactor(material, r, g, b) {
  material.emissiveFactor = [r, g, b];
  return material;
}

/**
 * Set alpha mode and cutoff.
 */
export function setAlphaMode(material, mode, cutoff) {
  material.alphaMode = mode; // "OPAQUE", "MASK", "BLEND"
  if (mode === "MASK" && cutoff !== undefined) {
    material.alphaCutoff = cutoff;
  }
  return material;
}

/**
 * Set double-sided rendering.
 */
export function setDoubleSided(material, value) {
  material.doubleSided = !!value;
  return material;
}

/**
 * Commit changes: upload the modified composite JSON to IPFS.
 *
 * Since only the composite JSON changed (not buffers or images),
 * the new CID reflects only the material edits. Buffers and images
 * remain at their original CIDs.
 *
 * @param {object} composite - Modified composite glTF JSON
 * @returns {Promise<string>} New composite CID
 */
export async function commitCompositeChanges(composite) {
  const newCid = await writeJSONToIPFS(composite);
  console.log(`[MAT-EDIT] committed → ${newCid}`);
  return newCid;
}

/**
 * Full round-trip: fetch composite, apply mesh overrides, commit.
 *
 * @param {string} compositeCid - Current composite CID
 * @param {object} meshOverrides - Per-mesh color overrides
 * @param {string} [defaultColor] - Baseline color for all materials
 * @returns {Promise<{compositeCid: string, modified: number, skipped: number}>}
 */
export async function editCompositeColors(compositeCid, meshOverrides, defaultColor = null) {
  const composite = await fetchComposite(compositeCid);
  const stats = applyMeshOverrideColors(composite, meshOverrides, defaultColor);
  const newCid = await commitCompositeChanges(composite);
  return { compositeCid: newCid, ...stats };
}
