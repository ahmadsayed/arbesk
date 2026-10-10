/**
 * Jev triage of benchmark failures: why did this sample fail, or score low?
 * @remarks Jev (TypeSafe AI's decision model; see
 *   packages/cad-gen/src/backend/jev.ts) answers typed questions about one
 *   shared state with calibrated probabilities. It reads text only, so the
 *   state is the prompt, the ground-truth facts, the part's stats and the
 *   design - never the mesh. Its labels are judgements, not facts: the summary
 *   treats the cause table as advisory until a hand-labelled agreement check
 *   (bench-summary.mjs) has been recorded.
 */
import { askJev } from "../../packages/cad-gen/src/backend/jev.ts";

/** A build scoring below this (IoU, else IoGT) is triaged. */
export const LOW_SCORE = 0.5;

/** A choice answer below this confidence is reported as unsure. */
export const UNSURE_BELOW = 0.6;

const CODE_EXCERPT_CHARS = 3000;

/** Why a sample produced no acceptable part. */
export const FAILURE_CAUSES = {
  misread_prompt: "The design builds something other than what the prompt describes",
  unit_or_scale: "Dimensions are off through a units or scale mistake",
  helper_misuse: "A CAD helper function was called with wrong, missing or out-of-range arguments",
  degenerate_boolean: "A boolean, extrusion or revolve produced an empty, zero-volume or broken solid",
  gate_too_strict: "The part is reasonable but a validation gate rejected it",
  kernel_limit: "The script hit a resource limit such as the triangle budget or time",
  wrong_refusal: "The request was refused as unsuitable although it is a plain mechanical part",
  other: "None of the above",
};

/** How a built part differs from the ground truth. */
export const SHAPE_MISMATCHES = {
  orientation: "Right shape, but rotated or lying on a different axis than the ground truth",
  missing_feature: "A hole, cut, boss or other feature the prompt asks for is absent",
  extra_feature: "The part has features the prompt does not ask for",
  proportions: "The overall length, width and height ratios differ from the ground truth",
  scale_interpretation: "Dimensions were read at a different scale or as different quantities",
};

/**
 * @param {any} result A SampleResult.
 * @returns {boolean}
 */
export function needsTriage(result) {
  if (result.outcome !== "built") return true;
  return (result.metrics.iou ?? result.metrics.iogt) < LOW_SCORE;
}

/**
 * Server attempts and client builds that failed, in order.
 * @param {any} result
 * @returns {{ stage: string, gate?: string, error: string }[]}
 */
function roundsOf(result) {
  const server = (result.diagnostics?.attempts ?? []).filter((/** @type {any} */ a) => !a.ok)
    .map((/** @type {any} */ a) => ({
      stage: "server",
      error: a.error ?? a.gates.filter((/** @type {any} */ g) => !g.ok).map((/** @type {any} */ g) => g.gate + ": " + g.error).join("; "),
    }));
  const client = result.clientFailures.map((/** @type {any} */ f) => ({ stage: "client", gate: f.gate, error: f.error }));
  const final = result.error && result.clientFailures.length === 0 ? [{ stage: "final", error: result.error }] : [];
  return [...server, ...client, ...final];
}

/**
 * The state Jev reads for one sample.
 * @remarks Ground truth is scaled x100 into the mm the prompt was rewritten
 *   to, so sizes compare directly; volume scales by 100^3.
 * @param {any} result A SampleResult.
 * @returns {object}
 */
export function triageState(result) {
  const gt = result.groundTruth ?? {};
  const s = result.stats;
  const gtVolume = (gt.Volume_cubic_mm ?? 0) * 1e6;
  return {
    prompt_sent: result.prompt,
    outcome: result.outcome,
    ...(result.variant === "abstract"
      ? { scale_note: "The prompt gave no dimensions: compare proportions, not absolute size." }
      : {}),
    ground_truth_mm: {
      width: (gt.Width_mm ?? 0) * 100, height: (gt.Height_mm ?? 0) * 100, depth: (gt.Depth_mm ?? 0) * 100,
      volume_mm3: gtVolume, is_solid: gt.Is_Solid ?? null,
    },
    generated: s ? {
      size_mm: [0, 1, 2].map((a) => Number((s.bboxMm.max[a] - s.bboxMm.min[a]).toFixed(3))),
      volume_ratio_to_ground_truth: gtVolume > 0 ? Number((s.volumeMm3 / gtVolume).toFixed(4)) : null,
      bodies: s.bodies?.count ?? 1,
      triangles: s.triangles,
    } : "none",
    metrics: { iou: result.metrics.iou, iogt: result.metrics.iogt, chamfer: result.metrics.chamfer },
    design_summary: result.design?.summary ?? "none",
    parameters: result.design?.parameters ?? {},
    rounds: roundsOf(result),
    code_excerpt: (result.design?.code ?? "").slice(0, CODE_EXCERPT_CHARS),
  };
}

/**
 * The questions that apply to this sample's outcome.
 * @param {any} result A SampleResult.
 * @returns {Record<string, object>}
 */
export function questionsFor(result) {
  /** @type {Record<string, object>} */
  const q = {};
  if (result.outcome === "built") {
    q.shape_mismatch = {
      type: "choice",
      instructions: "The part was built but differs from the ground truth. What is the main difference? " +
        "Compare the generated size and volume ratio with the ground truth, and the design with the prompt.",
      criteria: SHAPE_MISMATCHES,
    };
  } else {
    q.failure_cause = {
      type: "choice",
      instructions: "Why did this CAD generation fail to produce an acceptable part? " +
        "Judge from the errors in rounds, the design and the prompt.",
      criteria: FAILURE_CAUSES,
    };
  }
  if (result.outcome === "gate_failed") {
    q.gate_false_positive = {
      type: "noul",
      instructions: "Was the part as designed acceptable for what the prompt asks, so that the validation " +
        "gate named in the last round rejected it wrongly?",
      criteria: { true: "The gate rejected an acceptable part", false: "The gate caught a real defect" },
    };
  }
  q.prompt_fixable = {
    type: "noul",
    instructions: "Would clearer system-prompt instructions, or better documentation of the CAD helper " +
      "library, likely have prevented this problem?",
    criteria: {
      true: "Better instructions or documentation would likely have prevented it",
      false: "The problem lies elsewhere: model capability, a gate, or the request itself",
    },
  };
  return q;
}

/** @typedef {{ label: string, confidence: number, unsure: boolean }} Label */

/**
 * Reads Jev's reply into the triage record.
 * @param {any} body Raw askJev reply.
 * @returns {{ failureCause?: Label, shapeMismatch?: Label, gateFalsePositive?: number,
 *   promptFixable?: number, usage: { prompt: number, completion: number } }}
 */
export function readTriage(body) {
  const a = body?.answers ?? {};
  /** @param {any} x @returns {Label | undefined} */
  const choice = (x) => (typeof x?.choice === "string"
    ? { label: x.choice, confidence: x.confidence ?? 0, unsure: (x.confidence ?? 0) < UNSURE_BELOW }
    : undefined);
  /** @param {any} x @returns {number | undefined} */
  const noul = (x) => (typeof x?.noul === "number" ? x.noul : undefined);
  const fields = {
    failureCause: choice(a.failure_cause), shapeMismatch: choice(a.shape_mismatch),
    gateFalsePositive: noul(a.gate_false_positive), promptFixable: noul(a.prompt_fixable),
  };
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    usage: { prompt: body?.usage?.input_tokens ?? 0, completion: body?.usage?.output_tokens ?? 0 },
  };
}

/**
 * Asks Jev about one sample. Never throws: a Jev failure must not fail the run.
 * @param {import("../../packages/cad-gen/src/backend/jev.ts").JevConfig} jev
 * @param {any} result A SampleResult.
 * @returns {Promise<any>} The triage record, or { error }.
 */
export async function triage(jev, result) {
  try {
    return readTriage(await askJev(jev, triageState(result), questionsFor(result)));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
