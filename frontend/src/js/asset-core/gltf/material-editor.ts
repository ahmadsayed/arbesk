/**
 * Arbesk glTF Material Editor
 *
 * Operates on composite glTF JSON (ipfs:// URI format). Fetches the
 * composite, modifies material properties, and uploads a new composite
 * CID - leaving buffer and image CIDs untouched (IPFS deduplication).
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

import { getRuntime } from "../runtime.ts";

/**
 * Fetch a composite glTF JSON from IPFS by CID.
 *
 * @param compositeCid - IPFS CID of the composite glTF JSON
 * @returns Composite glTF JSON
 */
export async function fetchComposite(compositeCid: string): Promise<any> {
  if (!compositeCid) throw new Error("fetchComposite: compositeCid is required");
  console.log(`[MAT-EDIT] fetching composite | cid=${compositeCid}`);
  const gltf = await getRuntime().ipfsRead.getJSON(compositeCid);

  // Validate it looks like a glTF
  if (!gltf.asset || !gltf.asset.version) {
    throw new Error(`CID ${compositeCid} does not appear to be a glTF file`);
  }

  return gltf;
}

/**
 * Find a material by index in the glTF.
 *
 * @param composite - Composite glTF JSON (dynamic schema)
 * @param materialIndex - Index into materials array
 * @returns The material object (mutable reference)
 */
export function getMaterial(composite: any, materialIndex: number = 0): any {
  if (!composite.materials || !composite.materials[materialIndex]) {
    throw new Error(
      `Material index ${materialIndex} not found (total: ${composite.materials?.length || 0})`
    );
  }
  return composite.materials[materialIndex];
}

interface MaterialMatch {
  material: any;
  meshIndex: number;
  primitiveIndex: number;
}

/**
 * Find all materials referenced by primitives of a named mesh.
 * A mesh may have multiple primitives each pointing to a different material
 * (e.g. vehicle body + glass window). Returns every match so callers can
 * apply edits to all of them, not just the first.
 *
 * @param composite - Composite glTF JSON (dynamic schema)
 * @param meshName - Name of the mesh to find (e.g., "flowercenter")
 */
export function findMaterialByMeshName(
  composite: any,
  meshName: string
): MaterialMatch[] {
  if (!composite.meshes || !meshName) return [];

  const results: MaterialMatch[] = [];

  for (let mi = 0; mi < composite.meshes.length; mi++) {
    const mesh = composite.meshes[mi];
    if (mesh.name !== meshName) continue;

    for (let pi = 0; pi < (mesh.primitives || []).length; pi++) {
      const prim = mesh.primitives[pi];
      if (prim.material === undefined || prim.material === null) continue;

      const mat = composite.materials?.[prim.material];
      if (mat) {
        results.push({
          material: mat,
          meshIndex: mi,
          primitiveIndex: pi,
        });
      }
    }
  }

  return results;
}

/**
 * Set the base color factor of a PBR material.
 * The factor is multiplied with the base color texture (if any).
 *
 * @param material - The material object to modify
 * @param color - RGBA array [r,g,b,a] or hex string "#RRGGBB"
 * @returns The modified material (same reference)
 */
export function setBaseColorFactor(material: any, color: number[] | string): any {
  material.pbrMetallicRoughness ||= {};

  let rgba: number[];
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
 * @param composite - Composite glTF JSON (dynamic schema)
 * @param meshOverrides - { "meshName": { color: "#RRGGBB" }, ... }
 * @param defaultColor - Hex color to apply to all materials as baseline
 */
export function applyMeshOverrideColors(
  composite: any,
  meshOverrides: Record<string, { color?: string }>,
  defaultColor: string | null = null
): { modified: number; skipped: number } {
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

    const results = findMaterialByMeshName(composite, meshName);
    if (results.length > 0) {
      for (const { material } of results) {
        setBaseColorFactor(material, override.color);
      }
      modified++;
      console.log(`[MAT-EDIT] mesh "${meshName}" → ${override.color} (${results.length} primitive(s))`);
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
export function setMetallicFactor(material: any, value: number): any {
  material.pbrMetallicRoughness ||= {};
  material.pbrMetallicRoughness.metallicFactor = Math.max(0, Math.min(1, value));
  return material;
}

/**
 * Set roughness factor.
 */
export function setRoughnessFactor(material: any, value: number): any {
  material.pbrMetallicRoughness ||= {};
  material.pbrMetallicRoughness.roughnessFactor = Math.max(0, Math.min(1, value));
  return material;
}

/**
 * Set emissive factor.
 */
export function setEmissiveFactor(material: any, r: number, g: number, b: number): any {
  material.emissiveFactor = [r, g, b];
  return material;
}

/**
 * Set alpha mode and cutoff.
 * @param mode - "OPAQUE", "MASK", "BLEND"
 */
export function setAlphaMode(material: any, mode: string, cutoff?: number): any {
  material.alphaMode = mode; // "OPAQUE", "MASK", "BLEND"
  if (mode === "MASK" && cutoff !== undefined) {
    material.alphaCutoff = cutoff;
  }
  return material;
}

/**
 * Set double-sided rendering.
 */
export function setDoubleSided(material: any, value: boolean): any {
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
 * @param composite - Modified composite glTF JSON
 * @returns New composite CID
 */
export async function commitCompositeChanges(
  composite: any,
  options: { assetName?: string; assetId?: string } = {}
): Promise<string> {
  const { assetName, assetId } = options;
  const newCid = await getRuntime().ipfsWrite.writeJSON(composite, null, {
    compress: true,
    assetId,
    filename: assetName || assetId ? `${assetName || assetId}_materials.gltf` : undefined,
  });
  console.log(`[MAT-EDIT] committed → ${newCid}`);
  return newCid;
}

/**
 * Full round-trip: fetch composite, apply mesh overrides, commit.
 *
 * @param compositeCid - Current composite CID
 * @param meshOverrides - Per-mesh color overrides
 * @param defaultColor - Baseline color for all materials
 */
export async function editCompositeColors(
  compositeCid: string,
  meshOverrides: Record<string, { color?: string }>,
  defaultColor: string | null = null,
  options: { assetName?: string; assetId?: string } = {}
): Promise<{ compositeCid: string; modified: number; skipped: number }> {
  const composite = await fetchComposite(compositeCid);
  const stats = applyMeshOverrideColors(composite, meshOverrides, defaultColor);
  const newCid = await commitCompositeChanges(composite, options);
  return { compositeCid: newCid, ...stats };
}
