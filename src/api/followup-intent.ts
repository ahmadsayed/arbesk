/**
 * Reads what a typed follow-up asks of an existing mesh: retexture, retopo,
 * rig, animate (and which motions), or a different shape altogether.
 * @remarks Before this, every typed prompt on a mesh chip retextured, so "make
 *   it walk" painted the model. One Jev call (see @arbesk/cad-gen's jev.ts for
 *   the transport) asks a Choice for the operation and, when Animate is on
 *   offer, one Noul per motion - several motions may apply, so they are
 *   separate yes/no questions rather than one Choice. All questions go in the
 *   same request; the client ignores the motion answers on other routes.
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

/** Operations a mesh bubble can offer; mirrors asset-core's FollowupAction. */
export const MESH_ACTIONS = ["retexture", "retopo", "auto-rig", "animate"] as const;
export type MeshAction = (typeof MESH_ACTIONS)[number];

/** Non-operation outcomes, always on offer. */
export type IntentOutcome = MeshAction | "new_model" | "unclear";

export const ACTION_QUESTION = "followup_action";
export const TRAVEL_QUESTION = "travel";
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

const ACTION_CRITERIA: Record<IntentOutcome, string> = {
  retexture: "Change only its surface: colour, material, texture, paint or finish, keeping the shape",
  retopo: "Rebuild its mesh topology: fewer or cleaner polygons, lower poly count, optimise or decimate the mesh",
  "auto-rig": "Add a skeleton or bones so it can be posed or animated later, without asking for a specific motion",
  animate: "Make it move: perform a motion or action such as walking, running, dancing, waving or fighting",
  new_model: "Change its shape or geometry, add or remove parts, or make a different object entirely",
  unclear: "None of these, or too vague to tell which",
};

/**
 * Tripo preset id -> the motion it plays, in the Animate dialog's order.
 * @remarks Keep in step with ANIMATE_PRESET_GROUPS in the frontend's
 *   create-panel.ts; the client drops any id it does not list.
 */
export const ANIMATION_MOTIONS: Record<string, string> = {
  "preset:idle": "Idle, standing still breathing",
  "preset:walk": "Walk",
  "preset:run": "Run",
  "preset:jump": "Jump",
  "preset:climb": "Climb",
  "preset:turn": "Turn around",
  "preset:slash": "Slash with a blade",
  "preset:shoot": "Shoot a weapon",
  "preset:biped:front_kick_01": "Front kick",
  "preset:biped:box_01": "Boxing punches",
  "preset:biped:cast_a_spell": "Cast a spell",
  "preset:hurt": "Get hurt, hit reaction",
  "preset:fall": "Fall down",
  "preset:dive": "Dive",
  "preset:biped:defeat_02": "Defeat, losing",
  "preset:biped:scared_01": "Scared, frightened",
  "preset:biped:dance_01": "Dance",
  "preset:biped:dance_02": "Dance (second style)",
  "preset:biped:cheer": "Cheer",
  "preset:biped:victory_celebration": "Victory celebration",
  "preset:biped:wave_goodbye_01": "Wave goodbye",
  "preset:biped:clap": "Clap",
  "preset:biped:bow": "Bow",
  "preset:biped:sit": "Sit down",
  "preset:biped:look_around": "Look around",
  "preset:biped:standing_relax": "Stand relaxed",
  "preset:biped:swim": "Swim",
};

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
  return {
    action,
    confidence: typeof choice.confidence === "number" ? choice.confidence : 0,
    probabilities: choice.probabilities ?? {},
    animations: askedMotions(answers),
    inPlace: !(typeof travel === "number" && travel >= TRAVEL_THRESHOLD),
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
