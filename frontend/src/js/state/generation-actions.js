/**
 * Follow-up action availability for a generation bubble.
 * Animated results are terminal (re-rigging an animated GLB is pointless);
 * rig-only results keep only Animate (retarget finishes them — retopo would
 * strip the skeleton, re-rigging duplicates it).
 * @param {{provider: string, task?: string}} record
 * @returns {Array<"retexture"|"retopo"|"auto-rig"|"animate">}
 */
export function followupActionsFor({ provider, task }) {
  if (provider !== "tripo3d") return [];
  if (task === "animate") return [];
  if (task === "rig") return ["animate"];
  return ["retexture", "retopo", "auto-rig", "animate"];
}
