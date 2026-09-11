/**
 * Bounded repair loop: generate, validate, feed failures back, retry.
 * @remarks One accepted request costs the user exactly one quota unit no matter
 *   how many attempts it spends (spec section 6). Repairs are internal to the
 *   server and free to the user.
 */
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

/** What one validator call produced: a verdict. */
type ValidatorVerdict = Awaited<ReturnType<RepairDeps["validate"]>>;

/**
 * Gate name recorded when the validator threw instead of returning a verdict.
 * @remarks Mirrors "document", the gate the parse failure is filed under: both
 *   name the *stage* that failed rather than a property of the design.
 */
const VALIDATOR_FAULT_GATE = "validator";

/**
 * Runs the validator, turning a throw into an ordinary failed attempt.
 * @remarks A validator that throws is a host fault, but it lands *after* the
 *   provider has been paid for a reply. Letting it escape would discard the
 *   attempt log - the token accounting the repair loop exists to produce - and
 *   hand the route an opaque 500 instead of a CadGenerationFailed carrying
 *   diagnostics. Only the validator call is covered here; the client call stays
 *   outside the try, so a ProviderError keeps propagating to the route's 502.
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

/**
 * Runs generation with bounded repair.
 * @param signal Optional caller cancellation, threaded to every provider call.
 * @throws CadGenerationFailed when the attempt budget is exhausted.
 */
export async function generateWithRepair(
  deps: RepairDeps,
  baseMessages: LlmMessage[],
  maxAttempts: number,
  signal?: AbortSignal,
): Promise<RepairOutcome> {
  const attempts: AttemptRecord[] = [];
  const tokens: TokenUsage = { prompt: 0, completion: 0 };
  let messages = baseMessages;
  let lastError = "generation failed";
  let lastGates: GateResult[] = [];

  for (let index = 0; index < maxAttempts; index++) {
    const { text, usage } = await deps.client.complete(messages, signal);
    tokens.prompt += usage.prompt;
    tokens.completion += usage.completion;

    let design: CadDesign;
    try {
      design = deps.parseDesign(JSON.parse(text));
    } catch (e) {
      lastError = (e as Error).message;
      lastGates = [{ gate: "document", ok: false, error: lastError }];
      attempts.push({ index, ok: false, gates: lastGates, error: lastError });
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
    lastGates = outcome.gates;
    messages = deps.buildRepairMessages(messages, design, lastError, lastGates);
  }

  throw new CadGenerationFailed(
    "CAD generation failed after " + maxAttempts + " attempts: " + lastError,
    { attempts, tokens },
  );
}
