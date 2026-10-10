/**
 * What a typed prompt refines: the active version behind the "Refining" chip.
 * @remarks A cad chip edits the part's design (priorDesign); a mesh chip
 *   retextures (Tripo3D). With a chip attached the chip decides the provider;
 *   without one the provider selector does.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { resolveCadDesign } from "../services/cad-design-source.ts";

export type RefineKind = "mesh" | "cad";

export interface ActiveVersion {
  kind: RefineKind;
  /** GLB (mesh) or 3MF / composite-3mf (cad) CID — the durable reference. */
  sourceAssetCid: string;
  manifestCid: string | null;
  name: string;
  /** cad only: set from a generation result, or loaded on first send. */
  design?: CadDesign;
  /**
   * The chat bubble this version came from, when there is one.
   * @remarks Lets a typed mesh follow-up run that bubble's actions (retopo,
   *   rig, animate) instead of always retexturing; absent, it retextures.
   */
  generationId?: string;
}

export type GenerationRoute =
  | { mode: "fresh"; provider: string }
  | { mode: "retexture"; provider: "tripo3d" }
  | { mode: "cad-edit"; provider: "cad" };

/** Provider a chip of this kind generates with. */
export function chipProvider(kind: RefineKind): "cad" | "tripo3d" {
  return kind === "cad" ? "cad" : "tripo3d";
}

/**
 * Decides how a typed prompt is generated.
 * @remarks An attached image always starts fresh (neither follow-up path
 *   takes images).
 */
export function decideGenerationRoute(input: {
  activeKind: RefineKind | null;
  selectedProvider: string;
  hasImage: boolean;
}): GenerationRoute {
  if (input.hasImage || !input.activeKind) {
    return { mode: "fresh", provider: input.selectedProvider };
  }
  return input.activeKind === "cad"
    ? { mode: "cad-edit", provider: "cad" }
    : { mode: "retexture", provider: "tripo3d" };
}

/**
 * Builds a cad chip for an opened or restored version.
 * @returns null unless the manifest is a CAD asset with a root model.
 */
export function cadChipFromManifest(manifest: any, manifestCid: string, name: string): ActiveVersion | null {
  if (!manifest?.metadata?.cad) return null;
  const root = (manifest.scene?.nodes || []).find((n: any) => n.source?.cid && !n.child_ref);
  if (!root) return null;
  return { kind: "cad", sourceAssetCid: root.source.cid, manifestCid, name };
}

/**
 * The design to send as priorDesign, loading it once per chip.
 * @returns null when it cannot be read; the caller tells the user.
 */
export async function resolveActiveDesign(version: ActiveVersion): Promise<CadDesign | null> {
  if (version.design) return version.design;
  const design = await resolveCadDesign(version.sourceAssetCid);
  if (design) version.design = design;
  return design;
}

/** True for the API's 400 whose validation issues point at priorDesign. */
export function isPriorDesignRejection(err: unknown): boolean {
  const e = err as { status?: number; details?: { issues?: Array<{ path?: unknown[] }> } };
  if (e?.status !== 400) return false;
  return (e.details?.issues ?? []).some((i) => Array.isArray(i.path) && i.path[0] === "priorDesign");
}
