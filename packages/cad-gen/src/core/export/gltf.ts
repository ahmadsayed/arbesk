/** Mesh to self-contained glTF JSON: the GLB document with its chunk as a base64 data URI. */
import type { CadDesign, CadMesh } from "../../types.ts";
import { buildPartDocument } from "./glb.ts";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function meshToGltf(mesh: CadMesh | CadMesh[], design: CadDesign): string {
  const { gltf, bin } = buildPartDocument(mesh, design);
  const buffer = gltf.buffers[0] as { byteLength: number; uri?: string };
  buffer.uri = "data:application/octet-stream;base64," + toBase64(bin);
  return JSON.stringify(gltf);
}
