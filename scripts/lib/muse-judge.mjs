/**
 * MUSE's design-intent judge: Gemini-3.1-Pro scoring a drawing against a rubric.
 * @remarks MUSE scores Stage 3 with a vision model that sees the case's task,
 *   the reference drawing, the candidate's drawing and a six-category pass/fail
 *   rubric. Leaderboard comparability rests on using the SAME judge and the
 *   SAME prompt, so SCORE_PROMPT is MUSE's `generate_score_sp` verbatim and the
 *   model is the paper's. Our score is recomputed from the six items rather
 *   than trusted from the judge's own arithmetic. A judge call that fails is
 *   recorded as an error, never as a zero: it says nothing about the part.
 */
import fs from "node:fs";

/** The paper's judge (arXiv 2605.28579), verified reachable on 2026-10-10. */
export const JUDGE_MODEL = "gemini-3.1-pro-preview";

/** The six rubric categories, in the rubric's order. */
export const CATEGORIES = Object.freeze([
  "Assembly Readiness", "Joint Design", "Tolerance", "Functional Adaptation", "Usage Stability", "Manufacturability",
]);

/** The paper's sub-scores: each the mean of two rubric categories. */
export const PAIRS = Object.freeze({
  functionality: ["Functional Adaptation", "Usage Stability"],
  manufacturability: ["Tolerance", "Manufacturability"],
  assemblability: ["Assembly Readiness", "Joint Design"],
});

/**
 * MUSE's scoring prompt, copied verbatim from the MUSE harness:
 * https://github.com/dong7313/muse @ dcb1638, src/judge_system/prompts/generate_score.py
 * (Xiaoyu Dong, Zhi Li, Xiao-Ming Wu). Its licence:
 *
 * MIT License
 *
 * Copyright (c) 2026 MUSE Benchmark contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export const SCORE_PROMPT = `
# Role & Objective

You are an expert Vision-LLM serving as a strict CAD (Computer-Aided Design) evaluator. Your task is to score a newly generated 3D model's 2D projection against a high-quality reference, strictly following the provided Evaluation Rubric.

# Input Variables

You will be provided with the following information via placeholders:

1. \`<Task_Doc>\`: The original design constraints and requirements.
2. \`<Reference_SVG>\`: The gold-standard visual anchor.
3. \`<Generated_SVG>\`: The candidate model's visual output to be evaluated.
4. \`<Evaluation_Rubric>\`: The strict, case-specific 0-1 Pass/Fail scoring criteria you MUST follow.

# Core Directives

1. **Strict Rubric Adherence**: Do NOT invent your own scoring rules. You must score each category exactly as 0 or 1 according to the Pass/Fail definitions provided in \`<Evaluation_Rubric>\`.

2. **Score the Generated Model**: Your final score and rationale MUST evaluate \`<Generated_SVG>\`. \`<Reference_SVG>\` is only a visual benchmark showing what correct geometry, topology, joints, proportions, and manufacturability may look like. Do NOT evaluate the reference image as the subject.

3. **Visual Evidence First**: Base your reasoning on the visual evidence present in \`<Generated_SVG>\`. Look for the specific visual evidence mentioned in the rubric, such as component boundaries, graph-node structure, physical joint regions, seams, clearances, wall thickness, support posture, openings, contact regions, load-bearing members, or shape proportions.

4. **Equivalence over Identity**: Do not penalize minor differences in viewpoint, rendering style, projection angle, or harmless geometric variation, as long as the physical logic, component topology, joint behavior, functional intent, usage stability, and manufacturing constraints required by the rubric are preserved.

5. **No Hidden Assumptions**: If a feature is not visually supported by \`<Generated_SVG>\`, do not assume it exists. Award a point only when the required evidence is visible or can be reliably inferred from the projection.

6. **Fail on Fatal Violations**: If \`<Generated_SVG>\` clearly violates a category's Fail condition in the rubric, assign 0 for that category even if some minor aspects look correct.

# Scoring and Normalization

Evaluate exactly the six rubric categories:

1. Assembly Readiness
2. Joint Design
3. Tolerance
4. Functional Adaptation
5. Usage Stability
6. Manufacturability

Each category receives either:

- 1: Pass
- 0: Fail

Compute:

\`overall_score_normalized = sum(category scores) / 6\`

The value must be a floating-point number between 0.0 and 1.0.

# Output Template

Output strict JSON only. Do not include Markdown, comments, or extra text.

{
  "overall_score_normalized": 0.0,
  "overall_summary": "A brief summary focusing entirely on the performance of <Generated_SVG>.",
  "items": [
    {
      "category_en": "Assembly Readiness",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    },
    {
      "category_en": "Joint Design",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    },
    {
      "category_en": "Tolerance",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    },
    {
      "category_en": "Functional Adaptation",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    },
    {
      "category_en": "Usage Stability",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    },
    {
      "category_en": "Manufacturability",
      "score": 1,
      "rationale": "Explicitly describe the visual evidence in <Generated_SVG> that justifies the score."
    }
  ]
}

---
Wait for the user to provide \`<Task_Doc>\`, \`<Reference_SVG>\`, \`<Generated_SVG>\`, and \`<Evaluation_Rubric>\`, then begin the evaluation.
`;

/** The judge answered, but not in the rubric's shape. */
export class JudgeFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "JudgeFormatError";
  }
}

/**
 * The judge cannot be used at all - billing or permission.
 * @remarks Every later call would fail the same way, so the run stops instead
 *   of recording a hundred judge errors.
 */
export class JudgeAbort extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "JudgeAbort";
  }
}

/** @param {Buffer} png */
const image = (png) => ({ inline_data: { mime_type: "image/png", data: png.toString("base64") } });

/**
 * The generateContent request body.
 * @param {{ spec: string, rubric: string, referencePng: Buffer, generatedPng: Buffer }} input
 * @returns {any}
 */
export function buildJudgeRequest(input) {
  return {
    system_instruction: { parts: [{ text: SCORE_PROMPT }] },
    contents: [{
      role: "user",
      parts: [
        { text: "<Task_Doc>\n" + input.spec + "\n</Task_Doc>\n<Reference_SVG>" },
        image(input.referencePng),
        { text: "</Reference_SVG>\n<Generated_SVG>" },
        image(input.generatedPng),
        { text: "</Generated_SVG>\n<Evaluation_Rubric>\n" + input.rubric + "\n</Evaluation_Rubric>" },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
}

/**
 * Validates the judge's JSON and recomputes the score from its items.
 * @param {string} text The model's reply.
 * @returns {{ items: any[], score: number, subScores: Record<string, number>, mismatch: boolean, summary: string }}
 * @throws {JudgeFormatError}
 */
export function parseJudgeResponse(text) {
  /** @type {any} */
  let out;
  try {
    out = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
  } catch {
    throw new JudgeFormatError("judge reply is not JSON: " + text.slice(0, 120));
  }
  const byName = new Map((Array.isArray(out?.items) ? out.items : []).map((/** @type {any} */ i) => [i?.category_en, i]));
  for (const c of CATEGORIES) {
    const item = byName.get(c);
    if (!item || (item.score !== 0 && item.score !== 1)) throw new JudgeFormatError("judge reply lacks a 0/1 score for " + c);
  }
  if (byName.size !== CATEGORIES.length) throw new JudgeFormatError("judge reply has categories outside the rubric");
  const score = CATEGORIES.reduce((sum, c) => sum + byName.get(c).score, 0) / CATEGORIES.length;
  /** @type {Record<string, number>} */
  const subScores = {};
  for (const [name, [a, b]] of Object.entries(PAIRS)) subScores[name] = (byName.get(a).score + byName.get(b).score) / 2;
  const claimed = Number(out.overall_score_normalized);
  return {
    items: CATEGORIES.map((c) => ({ category: c, score: byName.get(c).score, rationale: String(byName.get(c).rationale ?? "") })),
    score, subScores, mismatch: !(Math.abs(claimed - score) <= 0.01), summary: String(out.overall_summary ?? ""),
  };
}

/** Statuses worth retrying: rate limits and transient server trouble. */
const RETRY_STATUS = new Set([429, 500, 503]);
const BACKOFF_MS = [15000, 30000, 45000, 60000];

/**
 * Judges one case.
 * @param {{ apiKey: string, kase: { spec: string, rubric: string, referencePng: string },
 *   generatedPngFile: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} ctx
 * @returns {Promise<any>} The score record, or { model, judgeError } when the judge
 *   could not produce a valid answer.
 * @throws {JudgeAbort} On 402 or 403.
 */
export async function judgeCase(ctx) {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const body = JSON.stringify(buildJudgeRequest({
    spec: ctx.kase.spec, rubric: ctx.kase.rubric,
    referencePng: fs.readFileSync(ctx.kase.referencePng), generatedPng: fs.readFileSync(ctx.generatedPngFile),
  }));
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + JUDGE_MODEL + ":generateContent";
  let retries = 0;
  let malformed = 0;
  for (;;) {
    const started = Date.now();
    const res = await fetchImpl(url, {
      method: "POST", body, headers: { "Content-Type": "application/json", "x-goog-api-key": ctx.apiKey },
    });
    if (res.status === 402 || res.status === 403) {
      throw new JudgeAbort("Gemini refused the judge call (" + res.status + "): check billing for this key in AI Studio (https://ai.studio/projects)");
    }
    if (RETRY_STATUS.has(res.status) && retries < BACKOFF_MS.length) {
      const hinted = await retryDelayMs(res);
      await sleep(hinted !== null && hinted < 120000 ? hinted : BACKOFF_MS[retries]);
      retries++;
      continue;
    }
    if (!res.ok) return { model: JUDGE_MODEL, judgeError: "HTTP " + res.status };
    const payload = /** @type {any} */ (await res.json());
    const text = (payload?.candidates?.[0]?.content?.parts ?? []).map((/** @type {any} */ p) => p.text ?? "").join("");
    try {
      const parsed = parseJudgeResponse(text);
      const u = payload.usageMetadata ?? {};
      return {
        model: JUDGE_MODEL, ...parsed,
        usage: { prompt: u.promptTokenCount ?? 0, completion: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 },
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      if (!(e instanceof JudgeFormatError)) throw e;
      if (malformed++ >= 1) return { model: JUDGE_MODEL, judgeError: e.message };
    }
  }
}

/**
 * The server's suggested wait, from a google.rpc.RetryInfo detail.
 * @param {Response} res
 * @returns {Promise<number | null>}
 */
async function retryDelayMs(res) {
  try {
    const body = /** @type {any} */ (await res.json());
    const info = (body?.error?.details ?? []).find((/** @type {any} */ d) => typeof d?.retryDelay === "string");
    const seconds = info ? Number.parseFloat(info.retryDelay) : NaN;
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}
