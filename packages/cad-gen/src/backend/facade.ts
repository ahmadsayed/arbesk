/** Backend composition root for CAD generation: the only entry a route needs. */
import type { CadDesign, TokenUsage } from "../types.ts";
import { CONTRACT_VERSION, PRELUDE_VERSION } from "../core/contract.ts";
import { PRELUDE_NAMES } from "../core/prelude.ts";
import { parseDesign } from "../core/document.ts";
import { attributionsFor } from "../core/attribution.ts";
import type { Attribution } from "../core/attribution.ts";
import { validateStatic } from "./validate.ts";
import { createDeepSeekClient, ProviderError } from "./deepseek.ts";
import type { DeepSeekClient, LlmMessage } from "./deepseek.ts";
import { buildTurnMessages, buildRepairMessages } from "./prompt.ts";
import type { TurnInput } from "./prompt.ts";
import { generateWithRepair } from "./repair.ts";
import { selectLibraries, SUITABILITY_THRESHOLD } from "./select.ts";
import { CadRequestUnsuitable } from "../errors.ts";
import type { LibrarySelection } from "./select.ts";
import { createJevClient } from "./jev.ts";
import type { JevConfig } from "./jev.ts";
import type { AttemptRecord } from "./repair.ts";

/** What the server bounds. Kernel limits belong to the client, which runs the kernel. */
export interface CadLimits {
  maxRepairAttempts: number;
}

export interface CadGenConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Off by default - see buildPayload. */
  thinking?: boolean;
  /**
   * Thinking mode for client repair rounds; on unless false. On CADPrompt it
   * fixed 10 of 11 severed parts that plain mode returned unchanged.
   */
  repairThinking?: boolean;
  /** Before falling back to plain mode. */
  repairThinkingTimeoutMs?: number;
  limits?: Partial<CadLimits>;
  fetchImpl?: typeof fetch;
  /** Without it every request sees the whole catalog. */
  jev?: JevConfig;
}

/** A client-reported kernel failure: a hint for the prompt, never a verdict. */
export interface CadFailure {
  gate: string;
  error: string;
}

export interface CadGenerateInput extends TurnInput {
  repairAttempts?: number;
  /** Present on a repair round. */
  failures?: CadFailure[];
  signal?: AbortSignal;
}

export interface CadDiagnostics {
  selection: Omit<LibrarySelection, "tokens"> & { jevTokens: TokenUsage };
  attempts: AttemptRecord[];
  durationMs: number;
  tokens: TokenUsage;
}

/**
 * Deliberately no `validation` field: the server runs no kernel, so it only
 * guarantees the static gates, recorded in `diagnostics.attempts`.
 */
export interface CadGenerateResult {
  design: CadDesign;
  runtime: { contractVersion: number; preludeVersion: string };
  provider: { id: string; model: string };
  /** Computed from the helpers the script calls; empty when nothing licensed is used. */
  attribution: Attribution[];
  diagnostics: CadDiagnostics;
}

export interface CadGenerator {
  generate(input: CadGenerateInput): Promise<CadGenerateResult>;
}

const DEFAULTS: CadLimits = {
  maxRepairAttempts: 3,
};

export const DEFAULT_CAD_MODEL = "deepseek-flash";

/**
 * A client repair is the same conversation plus one turn, rendered by
 * buildRepairMessages so client and server failures cannot drift apart.
 */
function openingMessages(input: CadGenerateInput): LlmMessage[] {
  const failures = input.failures ?? [];
  if (failures.length === 0 || !input.priorDesign) return buildTurnMessages(input);
  // The failed design goes in as the assistant's reply: framed as the current
  // design to preserve, the model returned it unchanged.
  const { priorDesign: _failed, ...request } = input;
  return buildRepairMessages(
    buildTurnMessages(request),
    input.priorDesign,
    failures.map((f) => f.gate + ": " + f.error).join("; "),
    failures.map((f) => ({ gate: f.gate, ok: false, error: f.error })),
  );
}

/** Refuses unsuitable requests before DeepSeek is paid for them. */
function refuseUnsuitable(selection: LibrarySelection): void {
  const s = selection.suitability;
  if (s === undefined || s >= SUITABILITY_THRESHOLD) return;
  throw new CadRequestUnsuitable(
    "This looks like an artistic or organic model (a figure, an animal, a sculpture), not an " +
    "engineering part, so CAD generation cannot model it well. Use an organic 3D model " +
    "generator for it instead.",
    s,
  );
}

function selectionDiagnostics(selection: LibrarySelection): CadDiagnostics["selection"] {
  const { tokens, ...rest } = selection;
  return { ...rest, jevTokens: tokens };
}

/** Thinking repairs had a 19s median but 9% hit the provider's 120s limit. */
const REPAIR_THINKING_TIMEOUT_MS = 90000;

/** Retries only a timeout on the fallback client: other failures would repeat. */
function withPlainFallback(primary: DeepSeekClient, fallback: DeepSeekClient): DeepSeekClient {
  return {
    async complete(messages, signal) {
      try {
        return await primary.complete(messages, signal);
      } catch (err) {
        if (err instanceof ProviderError && err.reason === "timeout") return fallback.complete(messages, signal);
        throw err;
      }
    },
  };
}

/** repairAttempts is capped by the configured maximum. */
export function createCadGenerator(config: CadGenConfig): CadGenerator {
  const limits: CadLimits = { ...DEFAULTS, ...config.limits };
  const model = config.model ?? DEFAULT_CAD_MODEL;
  const wire = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    model,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  };
  const client = createDeepSeekClient({ ...wire, ...(config.thinking ? { thinking: true } : {}) });
  const repairClient = config.repairThinking === false || config.thinking
    ? client
    : withPlainFallback(
      createDeepSeekClient({
        ...wire, thinking: true, timeoutMs: config.repairThinkingTimeoutMs ?? REPAIR_THINKING_TIMEOUT_MS,
      }),
      client,
    );

  const jev = config.jev?.apiKey ? createJevClient(config.jev) : undefined;

  return {
    async generate(input) {
      const started = Date.now();
      const attempts = input.repairAttempts
        ? Math.min(input.repairAttempts, limits.maxRepairAttempts)
        : limits.maxRepairAttempts;

      const selection = await selectLibraries(jev, input, input.signal);
      refuseUnsuitable(selection);
      const turn = { ...input, libraries: selection.libraries, libraryFit: selection.fit };

      const outcome = await generateWithRepair({
        client: input.failures?.length ? repairClient : client,
        parseDesign,
        buildRepairMessages,
        // Static only: the server never runs the kernel. The prompt feeds the required-helper gate.
        validate: async (design) => validateStatic(design, PRELUDE_NAMES, input.prompt),
      }, openingMessages(turn), attempts, input.signal);

      return {
        design: { ...outcome.design, turn: (input.priorDesign?.turn ?? 0) + 1 },
        runtime: { contractVersion: CONTRACT_VERSION, preludeVersion: PRELUDE_VERSION },
        provider: { id: "deepseek", model },
        attribution: attributionsFor(outcome.design.code),
        diagnostics: {
          selection: selectionDiagnostics(selection),
          attempts: outcome.attempts,
          durationMs: Date.now() - started,
          tokens: outcome.tokens,
        },
      };
    },
  };
}
