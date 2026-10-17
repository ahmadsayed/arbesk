/**
 * Converts 3MF node placements saved before 3MF renders were scaled to metres.
 * @remarks Until commit d6dc9de1 (2026-10-17 06:19:37 UTC) a 3MF part
 *   rendered at 1 scene unit per millimetre, so its stored translation (e.g.
 *   a drop-to-floor lift of half its height) is in those units. The 3MF→glTF
 *   converter now scales parts to metres, which left older parts floating
 *   ~1000× too far from their anchor. Every save stamps `manifest.timestamp`,
 *   so a manifest older than the cutoff still holds millimetre-era
 *   translations; one saved after it is already in metres. A manifest with
 *   no timestamp is left alone (its era is unknown). 3MF's default unit is
 *   the millimetre, which every CAD part in the platform uses.
 */

/** When 3MF renders switched to metres (commit d6dc9de1). */
export const LEGACY_3MF_PLACEMENT_CUTOFF_MS = Date.UTC(2026, 9, 17, 6, 19, 37);

const MM_TO_METRES = 0.001;

/** Manifest objects already converted (a fetched object may be re-loaded). */
const converted = new WeakSet<object>();

function isLegacy3mfNode(node: any): boolean {
  return (
    node?.source?.format === "3mf" &&
    !node.child_ref &&
    Array.isArray(node.transform_matrix) &&
    node.transform_matrix.length === 16
  );
}

/**
 * Scales legacy 3MF translations in place and returns the manifest.
 * @param manifest - an asset manifest as fetched (other shapes pass through)
 */
export function normalizeLegacy3mfPlacements<T>(manifest: T): T {
  const m = manifest as any;
  if (!m || typeof m !== "object" || converted.has(m)) return manifest;
  converted.add(m);
  const legacy =
    typeof m.timestamp === "number" && m.timestamp < LEGACY_3MF_PLACEMENT_CUTOFF_MS;
  if (!legacy) return manifest;
  for (const node of m.scene?.nodes ?? []) {
    if (!isLegacy3mfNode(node)) continue;
    const matrix = [...node.transform_matrix];
    for (const i of [12, 13, 14]) matrix[i] *= MM_TO_METRES;
    node.transform_matrix = matrix;
  }
  return manifest;
}
