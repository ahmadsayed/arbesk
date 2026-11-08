/**
 * TypeSafe AI's Jev: one call scores every catalog entry plus the request-level
 * questions, with calibrated answers (https://docs.typesafe.ai/api). The key is
 * never logged.
 */
import type { TokenUsage } from "../types.ts";

export interface JevConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface LibraryFit {
  score: number;
  confidence: number;
}

/** The rubric every entry is scored on, 0 to 2. */
export const FIT_LEVELS = ["Not needed", "Possibly useful", "Clearly needed"] as const;

/** The selector treats any JevError as "no selection". */
export class JevError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

export interface JevClient {
  /** `candidates` maps id to a one-line description. */
  scoreFit(
    request: string,
    candidates: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{
    fit: Record<string, LibraryFit>;
    expectedPieces?: number;
    piecesSeparate?: number;
    suitability?: number;
    usage: TokenUsage;
  }>;
}

/**
 * "Can parametric CAD model this at all?" Measured: engineering parts
 * 0.96-0.99, decorative geometry 0.73-0.91, sculpted subjects 0.03-0.18.
 */
export const SUITABILITY_QUESTION = "cad_suitable";

const SUITABILITY = {
  type: "noul",
  instructions: "Can the requested object be modelled well by a parametric CAD script that builds " +
    "it from geometric primitives, 2D profiles, extrusions, revolutions and boolean operations - " +
    "an engineering, functional or geometric part - WITHOUT needing free-form organic sculpting " +
    "such as characters, people, animals, faces, figurines, statues or realistic natural shapes?",
  criteria: {
    true: "A geometric or functional part that CAD primitives can model",
    false: "An artistic, organic or sculpted model that needs free-form sculpting",
  },
};

/** "How many separate pieces does the request imply?" */
export const PIECE_COUNT_QUESTION = "piece_count";

/** "many" is 5 or more. */
export const PIECE_COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, many: 5 };

const PIECE_COUNT = {
  type: "choice",
  instructions: "How many SEPARATE, unjoined solid pieces will the finished print of this request " +
    "consist of? Count pieces that are printed loose or captive (a print-in-place hinge's two " +
    "leaves are 2). Do NOT count screws, nuts, magnets or other bought hardware, and do not " +
    "count features of one piece (holes, slots, ribs) as pieces.",
  criteria: {
    one: "1 piece - a single connected part",
    two: "2 pieces",
    three: "3 pieces",
    four: "4 pieces",
    many: "5 or more pieces",
  },
};

/**
 * "Would one fused solid be wrong?" Decides whether fewer bodies than the piece
 * count is a defect. See SEPARATE_THRESHOLD in core/gates.ts.
 */
export const SEPARATE_QUESTION = "pieces_separate";

const SEPARATE = {
  type: "noul",
  instructions: "Would printing this request as ONE fused, connected solid be wrong - for example " +
    "two clamp halves that must close around something, a set of several items, or a lid that " +
    "must come off or slide?",
  criteria: {
    true: "Fused into one solid it is wrong: the request needs separate loose pieces",
    false: "A single connected solid is fine",
  },
};

function fitQuestions(candidates: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(candidates).map(([id, summary]) => [id, {
    type: "score",
    instructions: "How much does designing the requested part need this library module: " +
      summary + "?",
    criteria: [...FIT_LEVELS],
  }]));
}

/** Refuses a reply that is not the documented shape. */
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

/** One POST to /v1/systemone; exported for the offline tools that ask other questions. */
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

const noulOf = (answer: any): number | undefined =>
  typeof answer?.noul === "number" ? answer.noul : undefined;

/** Piece count, separation and suitability, leaving out any missing. */
function readJudgements(answers: any): {
  expectedPieces?: number; piecesSeparate?: number; suitability?: number;
} {
  const judged = {
    expectedPieces: PIECE_COUNTS[answers?.[PIECE_COUNT_QUESTION]?.choice],
    piecesSeparate: noulOf(answers?.[SEPARATE_QUESTION]),
    suitability: noulOf(answers?.[SUITABILITY_QUESTION]),
  };
  return Object.fromEntries(Object.entries(judged).filter(([, v]) => v !== undefined));
}

const usageOf = (body: any): TokenUsage => ({
  prompt: body?.usage?.input_tokens ?? 0,
  completion: body?.usage?.output_tokens ?? 0,
});

export function createJevClient(config: JevConfig): JevClient {
  return {
    async scoreFit(request, candidates, signal) {
      const body = await askJev(config, "CAD part request: " + request,
        {
          ...fitQuestions(candidates),
          [PIECE_COUNT_QUESTION]: PIECE_COUNT,
          [SEPARATE_QUESTION]: SEPARATE,
          [SUITABILITY_QUESTION]: SUITABILITY,
        }, signal);
      return {
        fit: readFits(body, Object.keys(candidates)),
        ...readJudgements(body?.answers),
        usage: usageOf(body),
      };
    },
  };
}
