/**
 * Direct Source Color Editor
 *
 * Edits per-component colors directly inside a monolithic glTF/GLB source asset.
 * No post-processor overrides - the color is baked into the source CID.
 *
 * The pure glTF-JSON mutation lives in apply-node-colors.ts (worker-safe: no
 * runtime ports, no @gltf-transform); this module adds the IPFS-backed flow.
 */

import { getRuntime } from "../../runtime.ts";
import { isGLB, decompose } from "./glb-parser.ts";
import { applyNodeColors } from "./apply-node-colors.ts";

export { applyNodeColors };

/**
 * Edit colors in a source asset (glTF JSON or GLB) and upload the new asset.
 *
 * The stored result is always glTF JSON: GLB sources are decomposed into a
 * composite glTF first (colors live in JSON, so we never re-serialize back to
 * GLB). The returned `format`/`path` let the caller keep the manifest node in
 * sync - a node whose source was a GLB must stop claiming `format: "glb"` once
 * its content is glTF JSON, or the loader picks the binary-GLB path and fails.
 *
 * @param sourceCid - Current source CID
 * @param nodeColors - { "nodeName": "#RRGGBB", ... }
 */
export async function editSourceColors(
  sourceCid: string,
  nodeColors: Record<string, string>,
  options: {
    /** Asset name for IPFS filename */
    assetName?: string;
    /** Asset ID for IPFS filename */
    assetId?: string;
    dedupMap?: Map<string, string> | null;
  } = {}
): Promise<{ sourceCid: string; format?: string; path?: string; modified: number; skipped: number }> {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid) throw new Error("editSourceColors: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf: any = null;
  let decomposedFromGlb = false;

  try {
    const { ipfsRead } = getRuntime();
    const buffer = await ipfsRead.getBytes(sourceCid);
    if (isGLB(buffer)) {
      // Decompose GLB into composite glTF before editing. Colors live in JSON,
      // so we never need to re-serialize back to GLB for storage. Skip storing
      // the intermediate composite - we write the edited version below.
      const { composite } = await decompose(buffer, undefined, {
        storeComposite: false,
        dedupMap,
      });
      gltf = composite;
      decomposedFromGlb = true;
    } else {
      gltf = await ipfsRead.getJSON(sourceCid);
    }
  } catch (err) {
    console.warn(`[SRC-COLOR] failed to fetch ${sourceCid}: ${(err as Error).message}`);
    throw err;
  }

  const stats = applyNodeColors(gltf, nodeColors);

  const newCid = await getRuntime().ipfsWrite.writeJSON(gltf, null, {
    compress: true,
    assetId,
    filename: assetName || assetId ? `${assetName || assetId}_colored.gltf` : undefined,
  });

  console.log(`[SRC-COLOR] source ${sourceCid} → ${newCid} | modified=${stats.modified} skipped=${stats.skipped}`);

  // Stored content is always glTF JSON now. Signal the format so the caller can
  // correct a node that was previously a GLB; only set the composite path when
  // we actually decomposed a GLB (don't clobber an existing glTF source's path).
  const result: { sourceCid: string; format: string; path?: string; modified: number; skipped: number } =
    { sourceCid: newCid, format: "gltf", ...stats };
  if (decomposedFromGlb) result.path = "composite.gltf";
  return result;
}
