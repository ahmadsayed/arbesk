/**
 * Follow-up action availability for a generation bubble.
 * Animated results are terminal (re-rigging an animated GLB is pointless);
 * rig-only results keep only Animate (retarget finishes them — retopo would
 * strip the skeleton, re-rigging duplicates it). A known non-glTF source
 * format (e.g. 3MF) gets nothing — Tripo's follow-up endpoints only accept
 * glTF/GLB input; unknown/absent formats stay actionable and the backend
 * validates (it composes glTF JSON to GLB and rejects the rest with
 * SOURCE_ASSET_UNSUPPORTED_FORMAT). "upload" records (viewport file drops,
 * Library uploads) get the same row as Tripo3D results — the follow-ups run
 * off sourceAssetCid, which any staged upload has.
 * @param {{provider: string, task?: string, format?: string}} record
 * @returns {Array<"retexture"|"retopo"|"auto-rig"|"animate">}
 */
export function followupActionsFor({ provider, task, format }) {
  if (provider !== "tripo3d" && provider !== "upload") return [];
  if (task === "animate") return [];
  if (task === "rig") return ["animate"];
  if (format && format !== "glb" && format !== "gltf") return [];
  return ["retexture", "retopo", "auto-rig", "animate"];
}
