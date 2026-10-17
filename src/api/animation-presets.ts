/**
 * Tripo retarget preset catalog — the single source of truth for which
 * animations Arbesk offers.
 *
 * Tripo has no API that lists presets (verified 2026-10-17: no GET endpoint
 * in the v3 docs, and likely paths 404), so this mirrors the retarget docs:
 * https://developers.tripo3d.com/en/docs/animations-retarget
 *
 * Consumers: request validation (schemas.ts), the animate-chain mismatch
 * guard (assets/generate-node.ts), Jev's motion questions
 * (followup-intent.ts), and the Studio Animate dialog, which reads the
 * catalog from GET /api/v1/config (`animationPresets`).
 */

export const RIG_MODEL_BIPED = "v1.0-20240301";
export const RIG_MODEL_GENERIC = "v2.5-20260210";

export interface AnimationPreset {
  /** Tripo preset id sent to retarget */
  id: string;
  /** Animate dialog row label */
  label: string;
  /** Animate dialog group */
  category: string;
  /** rig-check `rig_type` this preset retargets onto */
  skeleton: string;
  /** the only rig model that takes it; absent = either */
  rigModel?: string;
  /** ticked when the dialog opens */
  default?: boolean;
  /** what the motion is, for Jev's follow-up reading */
  motion: string;
}

const biped = (
  id: string, label: string, category: string, motion: string, extra: Partial<AnimationPreset> = {},
): AnimationPreset => ({
  id, label, category, skeleton: "biped", motion,
  // The v1.0 humanoid library only exists on the v1.0 rig.
  ...(id.startsWith("preset:biped:") && { rigModel: RIG_MODEL_BIPED }),
  ...extra,
});

const creature = (id: string, label: string, skeleton: string, motion: string): AnimationPreset => ({
  id, label, category: "Creatures", skeleton, rigModel: RIG_MODEL_GENERIC, motion,
});

/**
 * Every offered preset, in Animate dialog order.
 * @remarks Short-form ids (preset:walk) are biped-only on both rig lines — a
 *   quadruped rejects them with code 1004 at retarget. Each creature
 *   skeleton has exactly the presets listed for it; avian has none.
 */
export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  biped("preset:idle", "Idle", "Basics", "Idle, standing still breathing", { default: true }),
  biped("preset:walk", "Walk", "Basics", "Walk", { default: true }),
  biped("preset:run", "Run", "Basics", "Run"),
  biped("preset:jump", "Jump", "Basics", "Jump"),
  biped("preset:climb", "Climb", "Basics", "Climb"),
  biped("preset:turn", "Turn", "Basics", "Turn around"),
  biped("preset:slash", "Slash", "Combat", "Slash with a blade"),
  biped("preset:shoot", "Shoot", "Combat", "Shoot a weapon"),
  biped("preset:biped:front_kick_01", "Front Kick", "Combat", "Front kick"),
  biped("preset:biped:box_01", "Box", "Combat", "Boxing punches"),
  biped("preset:biped:cast_a_spell", "Cast a Spell", "Combat", "Cast a spell"),
  biped("preset:hurt", "Hurt", "Reactions", "Get hurt, hit reaction"),
  biped("preset:fall", "Fall", "Reactions", "Fall down"),
  biped("preset:dive", "Dive", "Reactions", "Dive"),
  biped("preset:biped:defeat_02", "Defeat", "Reactions", "Defeat, losing"),
  biped("preset:biped:scared_01", "Scared", "Reactions", "Scared, frightened"),
  biped("preset:biped:dance_01", "Dance 1", "Emotes", "Dance"),
  biped("preset:biped:dance_02", "Dance 2", "Emotes", "Dance (second style)"),
  biped("preset:biped:cheer", "Cheer", "Emotes", "Cheer"),
  biped("preset:biped:victory_celebration", "Victory", "Emotes", "Victory celebration"),
  biped("preset:biped:wave_goodbye_01", "Wave Goodbye", "Emotes", "Wave goodbye"),
  biped("preset:biped:clap", "Clap", "Emotes", "Clap"),
  biped("preset:biped:bow", "Bow", "Emotes", "Bow"),
  biped("preset:biped:sit", "Sit", "Daily Life", "Sit down"),
  biped("preset:biped:look_around", "Look Around", "Daily Life", "Look around"),
  biped("preset:biped:standing_relax", "Relax", "Daily Life", "Stand relaxed"),
  biped("preset:biped:swim", "Swim", "Daily Life", "Swim"),
  creature("preset:quadruped:walk", "Walk (four-legged)", "quadruped", "Walk on four legs"),
  creature("preset:hexapod:walk", "Walk (six-legged)", "hexapod", "Walk on six legs, like an insect"),
  creature("preset:octopod:walk", "Walk (eight-legged)", "octopod", "Walk on eight legs, like a spider"),
  creature("preset:serpentine:march", "Slither (serpent)", "serpentine", "Slither like a snake"),
  creature("preset:aquatic:march", "Swim (aquatic)", "aquatic", "Swim like a fish"),
];

export const ANIMATION_PRESET_IDS = ANIMATION_PRESETS.map((p) => p.id) as [string, ...string[]];

const BY_ID = new Map(ANIMATION_PRESETS.map((p) => [p.id, p]));

export function findAnimationPreset(id: string): AnimationPreset | undefined {
  return BY_ID.get(id);
}

/**
 * Why a preset can't retarget onto this skeleton / rig model.
 * @param rigModel - the rig model in use; absent = auto (not yet known)
 * @returns a short reason, or null when it fits
 */
export function presetMisfit(id: string, rigType: string, rigModel?: string): string | null {
  const preset = BY_ID.get(id);
  if (!preset) return "unknown preset";
  if (preset.skeleton !== rigType) return `${preset.skeleton} only`;
  if (preset.rigModel && rigModel && preset.rigModel !== rigModel) {
    return preset.rigModel === RIG_MODEL_BIPED ? "needs v1.0 rig" : "needs v2.5 rig";
  }
  return null;
}
