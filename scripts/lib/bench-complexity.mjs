/**
 * Jev's complexity score for one benchmark request, measured observe-only.
 * @remarks DeepSeek thinking mode is suspected to help on complex parts and to
 *   be too slow to leave on for every request, but routing by expected
 *   complexity needs data before it can be designed. This module asks one Jev
 *   `score` question per sample so the summary can band the metrics by how hard
 *   Jev judges the request to be, and so a later A/B (--thinking on|off) has a
 *   complexity axis to be read against. Nothing here changes the shipped
 *   generator: the harness records, production is untouched.
 *
 *   The state format is exactly the production selector's
 *   ("CAD part request: " + request - see packages/cad-gen/src/backend/jev.ts
 *   scoreFit), so a score here means what the same score means in production.
 */
import { askJev } from "../../packages/cad-gen/src/backend/jev.ts";

/**
 * The ordered complexity rubric; Jev's score indexes this array.
 * @remarks Four levels rather than a continuous scale: a Jev `score` answer is
 *   a criteria index, and four bands are coarse enough to hold around 50 of the
 *   200 benchmark prompts each, which is what makes a per-band median readable.
 */
export const COMPLEXITY_LEVELS = [
  "a single primitive or extrusion",
  "a few features or operations",
  "many interacting features",
  "an intricate multi-part assembly or fine detail",
];

/** Question id of the complexity score; the key in Jev's answers map too. */
export const COMPLEXITY_QUESTION = "expected_complexity";

/** The score question, as Jev receives it. */
const COMPLEXITY = {
  type: "score",
  instructions: "How complex is the part this request describes - how many features and CAD " +
    "operations does building it take, from a single primitive up to an intricate assembly?",
  criteria: [...COMPLEXITY_LEVELS],
};

/**
 * The band a score falls in.
 * @remarks Rounded then clamped, so a fractional score (1.5) or one Jev reports
 *   outside 0..3 still lands in a real band instead of indexing past the array.
 * @param {number} score Jev's complexity score.
 * @returns {string} One of COMPLEXITY_LEVELS.
 */
export function complexityBand(score) {
  const i = Math.min(COMPLEXITY_LEVELS.length - 1, Math.max(0, Math.round(score)));
  return COMPLEXITY_LEVELS[i];
}

/**
 * Asks Jev how complex one request is.
 * @remarks Never throws: this is an observation, and a failed observation must
 *   not fail the sample it describes.
 * @param {import("../../packages/cad-gen/src/backend/jev.ts").JevConfig} jevConfig
 * @param {string} prompt The request as it was sent to the generator.
 * @returns {Promise<{ score: number, confidence: number,
 *   usage: { prompt: number, completion: number } } | { error: string }>}
 */
export async function askComplexity(jevConfig, prompt) {
  try {
    const body = await askJev(jevConfig, "CAD part request: " + prompt, { [COMPLEXITY_QUESTION]: COMPLEXITY });
    const answer = body?.answers?.[COMPLEXITY_QUESTION];
    if (typeof answer?.score !== "number") {
      return { error: "jev reply has no numeric " + COMPLEXITY_QUESTION + " score" };
    }
    return {
      score: answer.score,
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      usage: { prompt: body?.usage?.input_tokens ?? 0, completion: body?.usage?.output_tokens ?? 0 },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
