/**
 * Loads a monolithic source asset as editable glTF JSON, for source edits
 * (color bakes, part removal) that rewrite it under a new CID.
 */

import { getRuntime } from "../../runtime.ts";
import { isGLB, decompose } from "./glb-parser.ts";

/**
 * Fetches a source (GLB or glTF JSON) as glTF JSON.
 * @remarks A GLB is decomposed into composite glTF first — edits live in
 *   JSON, so the result is never re-serialized to GLB. The intermediate
 *   composite isn't stored; the caller writes the edited version.
 * @returns the glTF and whether it came from a GLB (the caller then points
 *   the node at `composite.gltf`)
 */
export async function loadSourceGltf(
  sourceCid: string,
  dedupMap: Map<string, string> | null,
): Promise<{ gltf: any; decomposedFromGlb: boolean }> {
  const { ipfsRead } = getRuntime();
  const buffer = await ipfsRead.getBytes(sourceCid);
  if (isGLB(buffer)) {
    const { composite } = await decompose(buffer, undefined, {
      storeComposite: false,
      dedupMap,
    });
    return { gltf: composite, decomposedFromGlb: true };
  }
  return { gltf: await ipfsRead.getJSON(sourceCid), decomposedFromGlb: false };
}
