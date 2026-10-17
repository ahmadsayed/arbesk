/**
 * Reads what a typed follow-up asks of an existing mesh: retexture, retopo,
 * rig, animate (and which motions), or a different shape altogether.
 * @remarks Before this, every typed prompt on a mesh chip retextured, so "make
 *   it walk" painted the model. One Jev call (see @arbesk/cad-gen's jev.ts for
 *   the transport) asks a Choice for the operation and, when Animate is on
 *   offer, one Noul per motion - several motions may apply, so they are
 *   separate yes/no questions rather than one Choice. All questions go in the
 *   same request; the client ignores the motion answers on other routes.
 *   Two speculative Choices also ride along on EVERY request - the texture
 *   quality tier and the retopo reduction aggressiveness - so a follow-up that
 *   lands on retexture/retopo can prefill those dialogs; when Jev returns no
 *   reading for them (or the request routes elsewhere) the client leaves the
 *   fields undefined and keeps its own defaults.
 *
 *   Measured live on 22 prompts against a "knight character" (2026-10-10):
 *   unambiguous requests land at confidence 0.92-1.00 on the right operation
 *   ("make it gold" retexture, "low poly for a game" retopo, "add a skeleton"
 *   rig, "make him dance and wave" animate, "give it wings" new_model); vague
 *   ones spread out ("make it look scary" 0.36, "make it idle" 0.52). Motion
 *   nouls for asked motions sit at 0.56-0.98 and unasked ones below 0.5.
 */
import type { JevConfig } from "@arbesk/cad-gen/backend/index.js";
import { askJev, JevError } from "@arbesk/cad-gen/backend/index.js";
import { ANIMATION_PRESETS } from "./animation-presets.ts";

/** Operations a mesh bubble can offer; mirrors asset-core's FollowupAction. */
export const MESH_ACTIONS = ["retexture", "retopo", "split", "auto-rig", "animate"] as const;
export type MeshAction = (typeof MESH_ACTIONS)[number];

/** Non-operation outcomes, always on offer. */
export type IntentOutcome = MeshAction | "new_model" | "unclear";

export const ACTION_QUESTION = "followup_action";
export const TRAVEL_QUESTION = "travel";
/** Speculative question id for the texture quality tier. */
export const TEXTURE_QUALITY_QUESTION = "texture_quality";
/** Speculative question id for the retopo reduction tier. */
export const RETOPO_TIER_QUESTION = "retopo_tier";
/** Motion questions are keyed by this prefix plus the Tripo preset id. */
export const MOTION_PREFIX = "motion:";

/** A motion noul at or above this counts as asked for. */
export const MOTION_THRESHOLD = 0.5;
/** Tripo animates at most five presets per request. */
export const MAX_MOTIONS = 5;
/**
 * A travel noul at or above this turns root motion on.
 * @remarks "make it walk" measured 0.49 and "run across the room" 0.96, so a
 *   bare motion stays in place - the Animate dialog's own default.
 */
export const TRAVEL_THRESHOLD = 0.5;

/** Texture tiers a regeneration step can target; mirrors the create panel. */
export const TEXTURE_QUALITIES = ["fast", "standard", "detailed", "extreme"] as const;
export type TextureQuality = (typeof TEXTURE_QUALITIES)[number];

/**
 * Retopo tier id -> the face budget it implies.
 * @remarks "light" keeps fine detail, "medium" is the balanced default and
 *   "heavy" is stylized/game-ready; all inside the adapter's 500-20000 range.
 */
export const RETOPO_TIERS: Record<string, number> = { light: 20000, medium: 8000, heavy: 2000 };

const ACTION_CRITERIA: Record<IntentOutcome, string> = {
  retexture: "Change only its surface: colour, material, texture, paint or finish, keeping the shape",
  retopo: "Rebuild its mesh topology: fewer or cleaner polygons, lower poly count, optimise or decimate the mesh",
  split: "Separate it into its parts or components, for example to remove, hide or recolour one part such as horns, a hat or wheels",
  "auto-rig": "Add a skeleton or bones so it can be posed or animated later, without asking for a specific motion",
  animate: "Make it move: perform a motion or action such as walking, running, dancing, waving or fighting",
  new_model: "Change its overall shape or geometry, add new parts, or make a different object entirely",
  unclear: "None of these, or too vague to tell which",
};

/** Tripo preset id -> the motion it plays, in the Animate dialog's order. */
export const ANIMATION_MOTIONS: Record<string, string> = Object.fromEntries(
  ANIMATION_PRESETS.map((p) => [p.id, p.motion]),
);

export interface FollowupIntentInput {
  prompt: string;
  /** The chip's name - what the model is - so "make him wave" has a referent. */
  modelName?: string;
  /** The bubble's available actions; the Choice offers only these. */
  actions: MeshAction[];
}

export interface FollowupIntent {
  action: IntentOutcome;
  confidence: number;
  probabilities: Record<string, number>;
  /** Motions asked for, strongest first; empty unless Animate was offered. */
  animations: string[];
  inPlace: boolean;
  /** Texture tier implied by the request; undefined when Jev gave no reading. */
  textureQuality?: TextureQuality;
  /** Retopo face budget implied by the request; undefined when none. */
  retopoFaceLimit?: number;
}

/** The questions for one follow-up, restricted to the bubble's actions. */
export function followupQuestions(actions: readonly MeshAction[]): Record<string, unknown> {
  const offered: IntentOutcome[] = [...MESH_ACTIONS.filter((a) => actions.includes(a)), "new_model", "unclear"];
  const questions: Record<string, unknown> = {
    [ACTION_QUESTION]: {
      type: "choice",
      instructions: "The user has a generated 3D model open and typed `request` as a follow-up about it. " +
        "Which operation on that existing model does the request ask for?",
      criteria: Object.fromEntries(offered.map((o) => [o, ACTION_CRITERIA[o]])),
    },
    [TEXTURE_QUALITY_QUESTION]: {
      type: "choice",
      instructions: "If the request is carried out with an AI texture or mesh regeneration step, " +
        "which texture quality tier fits what the user asked for?",
      criteria: {
        fast: "A quick preview or iteration where speed matters more than fidelity",
        standard: "Normal quality, the everyday default",
        detailed: "High fidelity, accepting a slower generation",
        extreme: "Maximum 8K detail, only when the user explicitly demands the best, highest or 8K quality",
      },
    },
    [RETOPO_TIER_QUESTION]: {
      type: "choice",
      instructions: "If the request asks to rebuild/reduce the mesh topology, " +
        "how aggressive should the polygon reduction be?",
      criteria: {
        light: "Light reduction, about 20000 faces: keeps fine detail and faces",
        medium: "Medium reduction, about 8000 faces: a balanced default",
        heavy: "Heavy reduction, about 2000 faces: very low poly, stylized or game-ready",
      },
    },
  };
  if (!actions.includes("animate")) return questions;
  questions[TRAVEL_QUESTION] = {
    type: "noul",
    instructions: "Does `request` ask for the model to travel across the scene (move away from its " +
      "starting spot) rather than perform the motion on the spot?",
    criteria: { true: "It should move through the scene", false: "On the spot, or the request does not say" },
  };
  for (const [id, motion] of Object.entries(ANIMATION_MOTIONS)) {
    questions[MOTION_PREFIX + id] = { type: "noul", instructions: "Does `request` ask for this motion: " + motion + "?" };
  }
  return questions;
}

/** The asked-for motions: at or above MOTION_THRESHOLD, strongest first, capped. */
function askedMotions(answers: Record<string, any>): string[] {
  return Object.entries(answers)
    .filter(([key, a]) => key.startsWith(MOTION_PREFIX) && typeof a?.noul === "number" && a.noul >= MOTION_THRESHOLD)
    .sort(([, a], [, b]) => b.noul - a.noul)
    .slice(0, MAX_MOTIONS)
    .map(([key]) => key.slice(MOTION_PREFIX.length));
}

/**
 * Reads a Jev reply into a FollowupIntent.
 * @throws JevError when the reply lacks the action answer or names an action
 *   that was not offered.
 */
export function readFollowupIntent(body: any, actions: readonly MeshAction[]): FollowupIntent {
  const answers = body?.answers ?? {};
  const choice = answers[ACTION_QUESTION];
  if (typeof choice?.choice !== "string") throw new JevError("jev reply has no action answer", 502);
  const action = choice.choice as IntentOutcome;
  if ((MESH_ACTIONS as readonly string[]).includes(action) && !actions.includes(action as MeshAction)) {
    throw new JevError("jev chose an action that was not offered: " + action, 502);
  }
  const travel = answers[TRAVEL_QUESTION]?.noul;
  const texture = answers[TEXTURE_QUALITY_QUESTION]?.choice;
  return {
    action,
    confidence: typeof choice.confidence === "number" ? choice.confidence : 0,
    probabilities: choice.probabilities ?? {},
    animations: askedMotions(answers),
    inPlace: !(typeof travel === "number" && travel >= TRAVEL_THRESHOLD),
    textureQuality: (TEXTURE_QUALITIES as readonly string[]).includes(texture)
      ? (texture as TextureQuality)
      : undefined,
    retopoFaceLimit: RETOPO_TIERS[answers[RETOPO_TIER_QUESTION]?.choice],
  };
}

/** One Jev call for one follow-up. */
export async function judgeFollowup(
  config: JevConfig,
  input: FollowupIntentInput,
  signal?: AbortSignal,
): Promise<FollowupIntent> {
  const state = { request: input.prompt, ...(input.modelName ? { model: { name: input.modelName } } : {}) };
  const body = await askJev(config, state, followupQuestions(input.actions), signal);
  return readFollowupIntent(body, input.actions);
}
