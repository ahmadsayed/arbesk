/**
 * The parts (named sub-meshes) of a loaded model node, for the Outline.
 *
 * A multi-mesh glTF — a mock sample like howdy.glb, or a Tripo split result —
 * loads as one manifest node whose meshes are its parts. The viewport already
 * selects them (click a selected model again to pick a part); the Outline
 * lists them so they can be found and picked without hunting.
 */
import { state } from "../engine/state.ts";

export interface OutlinePart {
  /** Babylon mesh name — the key selectSubMesh() takes */
  name: string;
  /** row label */
  label: string;
  vertices: number;
}

/**
 * Parts under this share of the model's vertices are grouped as "small
 * pieces" — Tripo's connectivity split leaves dozens of 8–12 triangle slivers.
 */
const FRAGMENT_SHARE = 0.01;

/** "tripo_part_9" → "Part 9"; glTF primitive suffixes dropped; others as-is. */
export function partLabel(meshName: string): string {
  const name = meshName.replace(/_primitive\d+$/, "");
  const tripo = /^tripo_part_(\d+)$/.exec(name);
  return tripo ? `Part ${tripo[1]}` : name;
}

/**
 * The node's parts, largest first, with tiny fragments split out.
 * @returns null when the node isn't loaded or has fewer than two parts
 *   (a single mesh is the model itself, nothing to list)
 */
export function listNodeParts(nodeId: string): { main: OutlinePart[]; fragments: OutlinePart[] } | null {
  const meshes = state.nodeMeshes.get(nodeId);
  if (!meshes) return null;
  const byName = new Map<string, OutlinePart>();
  for (const m of meshes) {
    if (!m || m.isDisposed?.() || !m.name || m.name === "__root__") continue;
    // Removed (pending save) parts are hidden, so they drop out of the list.
    if (m.isEnabled?.() === false) continue;
    const vertices = typeof m.getTotalVertices === "function" ? m.getTotalVertices() : 0;
    if (vertices === 0) continue;
    const existing = byName.get(m.name);
    if (existing) existing.vertices += vertices;
    else byName.set(m.name, { name: m.name, label: partLabel(m.name), vertices });
  }
  const parts = [...byName.values()].sort((a, b) => b.vertices - a.vertices);
  if (parts.length < 2) return null;
  const total = parts.reduce((sum, p) => sum + p.vertices, 0);
  const cutoff = total * FRAGMENT_SHARE;
  return {
    main: parts.filter((p) => p.vertices >= cutoff),
    fragments: parts.filter((p) => p.vertices < cutoff),
  };
}
