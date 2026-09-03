/**
 * Reconstructs per-node state history by walking the manifest chain and
 * applies color/scale from historical versions to the current scene meshes.
 * @remarks Current state lives directly on each node (no variants array);
 *   history is the manifest chain.
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";

export interface ManifestChainVersion {
  cid: string;
  version: number;
  name: string | null;
  nodeCount: number;
  timestamp: any;
  color: string | null;
  scale: object;
  sourceCid: string | null;
  nodes: Record<string, string>;
  chat: Array<any> | null;
}

// Cache of manifest chain versions for each starting CID
const chainCache = new Map<string, ManifestChainVersion[]>();

/**
 * Clones a mesh's material when it is shared with other meshes.
 * @remarks Per-component color overrides need a unique material, otherwise
 *   recoloring one mesh bleeds into every mesh sharing that material.
 */
function ensureUniqueMaterial(mesh: BABYLON.AbstractMesh) {
  const mat = mesh.material;
  if (!mat || typeof mat.clone !== "function") return;

  const scene = mesh.getScene();
  const isShared = scene.meshes.some(
    (m: BABYLON.AbstractMesh) => m !== mesh && !m.isDisposed() && m.material === mat
  );
  if (!isShared) return;

  const clone = mat.clone(`${mat.name || "mat"}_iso_${mesh.name}`);
  if (!clone) return;

  // MultiMaterial: the cloned multi-material still references the original
  // sub-materials, so clone those too.
  if (mat.getSubMeshMaterials && clone.subMaterials) {
    const subs = mat.getSubMeshMaterials();
    if (subs.length > 0) {
      clone.subMaterials = subs.map((sub: any, i: number) =>
        sub && typeof sub.clone === "function"
          ? sub.clone(`${sub.name || "sub"}_iso_${mesh.name}_${i}`)
          : sub
      );
    }
  }

  mesh.material = clone;
}

/**
 * Apply a color to meshes.
 */
function applyColor(
  meshes: BABYLON.AbstractMesh[],
  colorHex?: string | null,
  meshOverrides: Record<string, { color: string }> | null = null
) {
  if (!colorHex && !meshOverrides) return;

  for (const mesh of meshes) {
    // Determine the effective color for this mesh:
    // meshOverrides take precedence, then fall back to the node default.
    const hasOverride =
      meshOverrides && mesh.name && meshOverrides[mesh.name]?.color;
    let effectiveColor: BABYLON.Color3 | null = null;
    if (hasOverride) {
      effectiveColor = BABYLON.Color3.FromHexString(
        meshOverrides[mesh.name].color
      );
    } else if (colorHex) {
      effectiveColor = BABYLON.Color3.FromHexString(colorHex);
    }

    if (!effectiveColor) continue;

    if (mesh.material) {
      // Per-component overrides must use a material unique to this mesh;
      // otherwise a shared material turns every component the same color.
      if (hasOverride) ensureUniqueMaterial(mesh);

      if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = effectiveColor;
      } else if (mesh.material.albedoColor) {
        mesh.material.albedoColor = effectiveColor;
      }
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor) mat.diffuseColor = effectiveColor;
          else if (mat.albedoColor) mat.albedoColor = effectiveColor;
        }
      }
    }
    for (const child of mesh.getChildMeshes()) {
      applyColor([child], colorHex, meshOverrides);
    }
  }
}

/**
 * Apply scale to meshes.
 */
function applyScale(
  meshes: BABYLON.AbstractMesh[],
  scale: { x?: number; y?: number; z?: number } | null
) {
  if (!scale) return;
  const s = new BABYLON.Vector3(scale.x || 1, scale.y || 1, scale.z || 1);
  for (const mesh of meshes) {
    if (mesh.metadata?.isNodeRoot) {
      mesh.scaling = s;
    }
  }
}

/**
 * Walks the manifest chain backward from a CID.
 * @returns versions in chronological order.
 */
async function walkManifestChain(
  startCid: string,
  maxDepth = 50
): Promise<ManifestChainVersion[]> {
  // Check cache first
  const cached = chainCache.get(startCid);
  if (cached) return cached;

  const chain: ManifestChainVersion[] = [];
  let cid: string | null = startCid;

  while (cid && chain.length < maxDepth) {
    try {
      const manifest = await getFromRemoteIPFS(cid);
      const nodes = manifest.scene?.nodes || [];
      const firstNode = nodes[0] || {};

      // Per-node snapshot for node-level change detection (model clock).
      // A snapshot string changes whenever the node's source, parametric
      // edits, or staged transform change between versions.
      const nodeSnapshots: Record<string, string> = {};
      for (const n of nodes) {
        if (!n.node_id) continue;
        nodeSnapshots[n.node_id] = JSON.stringify({
          sourceCid: n.source?.cid || null,
          postProcessor: n.post_processor || null,
          transform: n.transform_matrix || null,
        });
      }

      chain.unshift({
        cid,
        version: manifest.version || 0,
        name: manifest.name || null,
        nodeCount: (manifest.scene?.nodes || []).length,
        timestamp: manifest.timestamp || null,
        chat: manifest.metadata?.chat || null,
        color: firstNode.post_processor?.color || null,
        scale: firstNode.post_processor?.scale || { x: 1, y: 1, z: 1 },
        sourceCid: firstNode.source?.cid || null,
        nodes: nodeSnapshots,
      });

      cid = manifest.prev_asset_manifest_cid || null;
    } catch (err) {
      const e = err as Error;
      console.warn(
        `[TIME] walkManifestChain failed at cid=${cid}:`,
        e.message
      );
      break;
    }
  }

  // Cache the result
  chainCache.set(startCid, chain);
  return chain;
}

export { applyColor, applyScale, walkManifestChain };
