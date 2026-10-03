/**
 * TypeSafe AI's Jev, used to score how well each library entry fits a request.
 * @remarks Jev is a "System One" decision model: it does not generate text. It
 *   takes one shared `state` plus typed questions and returns a calibrated
 *   answer per question, so one call scores the WHOLE catalog - one `score`
 *   question per entry - in about 100-400 ms at $0.042 per million input
 *   tokens, with output free. That is what makes it the selector: a generating
 *   model would have to be prompted into a list and parsed back out of prose.
 *
 *   API: POST https://api.typesafe.ai/v1/systemone, Bearer auth, model
 *   "jev-latest" (docs: https://docs.typesafe.ai/api). The key is never logged.
 */
import type { TokenUsage } from "../types.ts";

export interface JevConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** One entry's fit: Jev's position on the FIT_LEVELS scale, and its confidence. */
export interface LibraryFit {
  score: number;
  confidence: number;
}

/** The ordered rubric every entry is scored on; the score runs 0 to 2. */
export const FIT_LEVELS = ["Not needed", "Possibly useful", "Clearly needed"] as const;

/** Thrown for any Jev failure; the selector treats it as "no selection". */
export class JevError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

export interface JevClient {
  /**
   * Scores each candidate against the request.
   * @param request What the user asked for (plus any current-design context).
   * @param candidates id -> a one-line description of the library entry.
   */
  scoreFit(
    request: string,
    candidates: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ fit: Record<string, LibraryFit>; separateParts?: number; usage: TokenUsage }>;
}

/**
 * Question id for "does the request intend separate, unjoined pieces?".
 * @remarks Asked in the SAME call as the fit scores - one more question costs
 *   a few dozen input tokens. Its answer decides whether a multi-body result is
 *   the intent (a print-in-place hinge) or a defect (a hook arm floating off its
 *   plate). Catalog ids are kebab-case, so this snake_case id cannot collide.
 */
export const SEPARATE_PARTS_QUESTION = "separate_parts";

const SEPARATE_PARTS = {
  type: "noul",
  instructions: "Does the request ask for a part made of separate pieces that are deliberately " +
    "NOT joined to each other - for example a print-in-place hinge, a box with a captive hinged " +
    "lid, a clamp printed as two halves, or a set of several separate items?",
  criteria: {
    true: "Several separate, unjoined pieces are intended",
    false: "One single connected part is intended",
  },
};

/** One score question per candidate, keyed by the candidate's id. */
function fitQuestions(candidates: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(candidates).map(([id, summary]) => [id, {
    type: "score",
    instructions: "How much does designing the requested part need this library module: " +
      summary + "?",
    criteria: [...FIT_LEVELS],
  }]));
}

/** Reads the answers map into fits, refusing a reply that is not the documented shape. */
function readFits(body: any, ids: string[]): Record<string, LibraryFit> {
  const answers = body?.answers;
  if (!answers || typeof answers !== "object") throw new JevError("jev reply has no answers", 502);
  const fit: Record<string, LibraryFit> = {};
  for (const id of ids) {
    const a = answers[id];
    if (typeof a?.score === "number") {
      fit[id] = { score: a.score, confidence: typeof a.confidence === "number" ? a.confidence : 0 };
    }
  }
  return fit;
}

/**
 * One POST to /v1/systemone: any state, any typed questions.
 * @remarks Exported for the offline tools (licence checks, candidate ranking)
 *   that ask Jev other questions than library fit.
 * @returns The raw reply body: `answers` keyed by question id, plus `usage`.
 */
export async function askJev(
  config: JevConfig,
  state: unknown,
  questions: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const url = (config.baseUrl ?? "https://api.typesafe.ai").replace(/\/+$/, "") + "/v1/systemone";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await (config.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ model: config.model ?? "jev-latest", state, questions }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new JevError("jev " + response.status + ": " + text.slice(0, 200), response.status);
    }
    return await response.json();
  } catch (err) {
    if (err instanceof JevError) throw err;
    throw new JevError("jev request failed: " + (err as Error).message, 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Jev's token usage, in this package's TokenUsage shape. */
const usageOf = (body: any): TokenUsage => ({
  prompt: body?.usage?.input_tokens ?? 0,
  completion: body?.usage?.output_tokens ?? 0,
});

export function createJevClient(config: JevConfig): JevClient {
  return {
    async scoreFit(request, candidates, signal) {
      const body = await askJev(config, "CAD part request: " + request,
        { ...fitQuestions(candidates), [SEPARATE_PARTS_QUESTION]: SEPARATE_PARTS }, signal);
      const separate = body?.answers?.[SEPARATE_PARTS_QUESTION]?.noul;
      return {
        fit: readFits(body, Object.keys(candidates)),
        ...(typeof separate === "number" ? { separateParts: separate } : {}),
        usage: usageOf(body),
      };
    },
  };
}
