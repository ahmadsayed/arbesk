/**
 * The Animate dialog's preset catalog and skeleton compatibility.
 *
 * The catalog is served by the backend (GET /api/v1/config →
 * `animationPresets`, sourced from src/api/animation-presets.ts) — Tripo has
 * no preset-listing API, so that file is the one place presets are edited.
 * Each preset names the rig-check skeleton it retargets onto and, when
 * pinned, the only rig model that takes it; the backend rejects a mismatch
 * before the paid rig step (ANIMATION_RIG_MISMATCH).
 */
import { getConfig } from "../services/app-config.ts";

/** Wire shape of one catalog entry (mirrors src/api/animation-presets.ts). */
export interface AnimationPreset {
  id: string;
  label: string;
  category: string;
  /** rig-check `rig_type` this preset retargets onto */
  skeleton: string;
  /** the only rig model that takes it; absent = either */
  rigModel?: string;
  /** ticked when the dialog opens */
  default?: boolean;
}

export interface RigContext {
  /** skeleton type from rig-check; null/undefined when unknown */
  rigType?: string | null;
  /** explicit rig model the user picked; empty/undefined = auto */
  rigModel?: string | null;
}

/**
 * The served preset catalog.
 * @returns null when the config is unavailable or predates the catalog
 */
export async function loadAnimationPresets(): Promise<AnimationPreset[] | null> {
  const config = await getConfig();
  const presets = config?.animationPresets;
  return Array.isArray(presets) && presets.length > 0 ? presets : null;
}

/** Catalog entries grouped by category, keeping catalog order. */
export function groupPresets(presets: AnimationPreset[]): Array<{ category: string; presets: AnimationPreset[] }> {
  const groups = new Map<string, AnimationPreset[]>();
  for (const p of presets) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category)!.push(p);
  }
  return [...groups].map(([category, items]) => ({ category, presets: items }));
}

/**
 * Why a preset can't be applied in this rig context.
 * @remarks An unknown skeleton (rig-check failed) allows every skeleton —
 *   the backend guard still blocks a mismatch before the paid rig.
 * @returns a short reason for the dialog, or null when the preset fits
 */
export function presetUnavailableReason(preset: AnimationPreset, { rigType, rigModel }: RigContext): string | null {
  if (rigType && rigType !== preset.skeleton) return `${preset.skeleton} only`;
  if (preset.rigModel && rigModel && preset.rigModel !== rigModel) {
    return preset.rigModel === "v1.0-20240301" ? "needs v1.0 rig" : "needs v2.5 rig";
  }
  return null;
}

/** Whether a rig-check skeleton type can use the v1.0 humanoid rig at all. */
export function supportsHumanoidRig(rigType?: string | null): boolean {
  return !rigType || rigType === "biped";
}
