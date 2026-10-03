/**
 * Mesh to self-contained glTF JSON, for previewing a CAD part.
 * @remarks Same document as the GLB export (buildPartDocument) — the binary
 *   chunk rides as a base64 data URI, so one string carries the whole part
 *   plus the design sidecar. Matches how the platform handles .gltf assets
 *   (base64 data URIs at render, ipfs:// refs in storage after the
 *   asset-core composer runs).
 */
import type { CadDesign, CadMesh } from "../../types.ts";
import { buildPartDocument } from "./glb.ts";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function meshToGltf(mesh: CadMesh, design: CadDesign): string {
  const { gltf, bin } = buildPartDocument(mesh, design);
  const buffer = gltf.buffers[0] as { byteLength: number; uri?: string };
  buffer.uri = "data:application/octet-stream;base64," + toBase64(bin);
  return JSON.stringify(gltf);
}
