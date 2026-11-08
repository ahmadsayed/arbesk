/** Bounded repair loop. Repairs are internal: one accepted request costs one quota unit. */
import type { CadDesign, TokenUsage } from "../types.ts";
import type { GateResult } from "../core/gates.ts";
import type { LlmMessage } from "./deepseek.ts";
import type { DeepSeekClient } from "./deepseek.ts";
import { CadGenerationFailed } from "../errors.ts";

export interface AttemptRecord {
  index: number;
  ok: boolean;
  gates: GateResult[];
  error?: string;
}

export interface RepairDeps {
  client: DeepSeekClient;
  parseDesign: (input: unknown) => CadDesign;
  buildRepairMessages: (
    base: LlmMessage[],
    previous: CadDesign,
    error: string,
    gates: GateResult[],
  ) => LlmMessage[];
  validate: (design: CadDesign) => Promise<{
    ok: boolean;
    gates: GateResult[];
    error?: string;
    stats?: unknown;
  }>;
}

export interface RepairOutcome {
  design: CadDesign;
  stats: unknown;
  attempts: AttemptRecord[];
  tokens: TokenUsage;
}

/** Tells the model why its last reply was not a design document, and what to do. */
function documentRepairMessages(
  messages: LlmMessage[],
  text: string,
  error: string,
): LlmMessage[] {
  return [
    ...messages,
    { role: "assistant", content: text },
    {
      role: "user",
      content:
        "That response was not a valid design document: " + error +
        " Return the JSON object exactly as specified.",
    },
  ];
}

type ValidatorVerdict = Awaited<ReturnType<RepairDeps["validate"]>>;

/** Names the stage that failed, like "document" for a parse failure. */
const VALIDATOR_FAULT_GATE = "validator";

/**
 * Turns a validator throw into a failed attempt, so the paid-for attempt log
 * survives. Provider errors still propagate to the route's 502.
 */
async function runValidate(
  validate: RepairDeps["validate"],
  design: CadDesign,
): Promise<ValidatorVerdict> {
  try {
    return await validate(design);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      gates: [{ gate: VALIDATOR_FAULT_GATE, ok: false, error }],
      error,
    };
  }
}

/** @throws CadGenerationFailed when the attempt budget is exhausted. */
export async function generateWithRepair(
  deps: RepairDeps,
  baseMessages: LlmMessage[],
  maxAttempts: number,
  signal?: AbortSignal,
): Promise<RepairOutcome> {
  const started = Date.now();
  const attempts: AttemptRecord[] = [];
  const tokens: TokenUsage = { prompt: 0, completion: 0 };
  let messages = baseMessages;
  let lastError = "generation failed";

  for (let index = 0; index < maxAttempts; index++) {
    const { text, usage } = await deps.client.complete(messages, signal);
    tokens.prompt += usage.prompt;
    tokens.completion += usage.completion;

    let design: CadDesign;
    try {
      design = deps.parseDesign(JSON.parse(text));
    } catch (e) {
      lastError = (e as Error).message;
      attempts.push({
        index,
        ok: false,
        gates: [{ gate: "document", ok: false, error: lastError }],
        error: lastError,
      });
      messages = documentRepairMessages(messages, text, lastError);
      continue;
    }

    const outcome = await runValidate(deps.validate, design);
    attempts.push({
      index,
      ok: outcome.ok,
      gates: outcome.gates,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
    if (outcome.ok) {
      return { design, stats: outcome.stats, attempts, tokens };
    }

    lastError = outcome.error ?? "validation failed";
    messages = deps.buildRepairMessages(messages, design, lastError, outcome.gates);
  }

  throw new CadGenerationFailed(
    "CAD generation failed after " + maxAttempts + " attempts: " + lastError,
    { attempts, tokens, durationMs: Date.now() - started },
  );
}
