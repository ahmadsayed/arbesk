/**
 * What a typed prompt on a mesh chip does, given Jev's reading of it.
 * @remarks The reading comes from POST /api/v1/followup-intent; this module is
 *   the policy, kept apart so thresholds are tested without the panel.
 *   Retexture is the only action that runs without a dialog, so it needs the
 *   higher bar; retopo, rig and animate open their own dialogs (prefilled), so
 *   the user confirms before any credits are spent. No reading at all - no Jev
 *   key, an outage, a timeout - keeps the old behaviour: retexture.
 */
import type { FollowupAction } from "@arbesk/asset-core/domain/generation-actions.js";

/** Jev's reading, as the route returns it. */
export interface FollowupIntent {
  action: FollowupAction | "new_model" | "unclear";
  confidence: number;
  probabilities: Record<string, number>;
  animations: string[];
  inPlace: boolean;
}

/** One option offered when the reading is too uncertain to act on. */
export type FollowupOption = FollowupAction | "new-model";

export type FollowupPlan =
  | { kind: "retexture" }
  | { kind: "retopo" }
  | { kind: "auto-rig" }
  | { kind: "animate"; animations: string[]; inPlace: boolean }
  | { kind: "new-model" }
  /**
   * Too uncertain to act: offer options. The motions ride along so picking
   * Animate opens the dialog with Jev's reading, as the confident route does.
   */
  | { kind: "ask"; options: FollowupOption[]; animations: string[]; inPlace: boolean };

/** Confidence to open a confirming dialog (retopo, rig, animate) or offer a new model. */
export const DIALOG_CONFIDENCE = 0.6;
/**
 * Confidence to retexture straight away.
 * @remarks Measured: clear texture requests land at 1.00, "make it look
 *   scary" at 0.36 - between them, asking costs one click, a wrong retexture
 *   costs credits.
 */
export const RETEXTURE_CONFIDENCE = 0.8;
/** How many options an "ask" offers. */
const ASK_OPTIONS = 2;

/** The plan for one reading. */
export function decideFollowup(intent: FollowupIntent | null, available: FollowupAction[]): FollowupPlan {
  if (!intent) return { kind: "retexture" };
  const { action, confidence } = intent;
  if (action === "new_model" && confidence >= DIALOG_CONFIDENCE) return { kind: "new-model" };
  if (action === "retexture" && confidence >= RETEXTURE_CONFIDENCE) return { kind: "retexture" };
  if (action !== "retexture" && available.includes(action as FollowupAction) && confidence >= DIALOG_CONFIDENCE) {
    return action === "animate"
      ? { kind: "animate", animations: intent.animations, inPlace: intent.inPlace }
      : { kind: action as "retopo" | "auto-rig" };
  }
  return { kind: "ask", options: likeliestOptions(intent, available), animations: intent.animations, inPlace: intent.inPlace };
}

/**
 * The options to ask between: the two Jev rated likeliest, best first.
 * @remarks When Jev's answer is "unclear" the other options carry no signal
 *   ("hmm" put ~0 on each), so every option is offered in menu order.
 */
function likeliestOptions(intent: FollowupIntent, available: FollowupAction[]): FollowupOption[] {
  const options: FollowupOption[] = [...available, "new-model"];
  if (intent.action === "unclear") return options;
  const p = (o: FollowupOption) => intent.probabilities[o === "new-model" ? "new_model" : o] ?? 0;
  return options.sort((a, b) => p(b) - p(a)).slice(0, ASK_OPTIONS);
}
