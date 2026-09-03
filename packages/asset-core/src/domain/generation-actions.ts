/**
 * Follow-up action availability for a generation bubble.
 * @remarks Animated results are terminal (re-rigging is pointless); rig-only
 *   results keep only Animate — retarget finishes them, while retopo would
 *   strip the skeleton and re-rigging duplicates it. A known non-glTF source
 *   format gets nothing (Tripo's follow-up endpoints accept only glTF/GLB);
 *   unknown/absent formats stay actionable and the backend validates.
 *   "upload" records get the same row as Tripo3D results — the follow-ups run
 *   off sourceAssetCid, which any staged upload has.
 */
export type FollowupAction = "retexture" | "retopo" | "auto-rig" | "animate";

export interface FollowupRecord {
  provider: string;
  task?: string;
  format?: string;
}

export function followupActionsFor({
  provider,
  task,
  format,
}: FollowupRecord): FollowupAction[] {
  if (provider !== "tripo3d" && provider !== "upload") return [];
  if (task === "animate") return [];
  if (task === "rig") return ["animate"];
  if (format && format !== "glb" && format !== "gltf") return [];
  return ["retexture", "retopo", "auto-rig", "animate"];
}
