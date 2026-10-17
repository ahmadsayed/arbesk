/**
 * Tripo retarget preset catalog (src/api/animation-presets.ts) — the single
 * source the schema, the animate-chain guard, Jev, and the Studio dialog
 * (via GET /config) all read.
 */
import { describe, expect, test } from "bun:test";
import {
  ANIMATION_PRESETS,
  ANIMATION_PRESET_IDS,
  RIG_MODEL_BIPED,
  RIG_MODEL_GENERIC,
  findAnimationPreset,
  presetMisfit,
} from "../../src/api/animation-presets.ts";
import { ANIMATION_MOTIONS } from "../../src/api/followup-intent.ts";

describe("animation preset catalog", () => {
  test("ids are unique and every entry is complete", () => {
    expect(new Set(ANIMATION_PRESET_IDS).size).toBe(ANIMATION_PRESETS.length);
    for (const p of ANIMATION_PRESETS) {
      expect(p.id).toMatch(/^preset:/);
      for (const field of ["label", "category", "skeleton", "motion"]) expect(p[field]).toBeTruthy();
    }
  });

  test("the v1.0 humanoid library is pinned to the v1.0 rig, creatures to v2.5", () => {
    expect(findAnimationPreset("preset:biped:dance_01").rigModel).toBe(RIG_MODEL_BIPED);
    expect(findAnimationPreset("preset:quadruped:walk").rigModel).toBe(RIG_MODEL_GENERIC);
    expect(findAnimationPreset("preset:walk").rigModel).toBeUndefined();
  });

  test("presetMisfit matches presets to skeleton and rig model", () => {
    expect(presetMisfit("preset:walk", "quadruped")).toBe("biped only");
    expect(presetMisfit("preset:quadruped:walk", "quadruped")).toBeNull();
    expect(presetMisfit("preset:quadruped:walk", "biped")).toBe("quadruped only");
    expect(presetMisfit("preset:biped:dance_01", "biped")).toBeNull();
    expect(presetMisfit("preset:biped:dance_01", "biped", RIG_MODEL_GENERIC)).toBe("needs v1.0 rig");
    expect(presetMisfit("preset:walk", "biped", RIG_MODEL_GENERIC)).toBeNull();
    expect(presetMisfit("preset:nope", "biped")).toBe("unknown preset");
  });

  test("Jev's motion questions come from the catalog, in dialog order", () => {
    expect(Object.keys(ANIMATION_MOTIONS)).toEqual(ANIMATION_PRESET_IDS);
  });
});
