/**
 * Backend composition root for CAD generation.
 * @remarks Wires the DeepSeek client, the prompt, the kernel-backed validator
 *   and the repair loop. This is the only entry the Express route needs.
 */
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

/**
 * What the server bounds. Deliberately small: the kernel limits (timeout,
 * triangle budget, wasm directory) belong to the host that runs the kernel, and
 * that host is the client.
 */
export interface CadLimits {
  /** Static repair rounds spent before giving up. */
  maxRepairAttempts: number;
}

export interface CadGenConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Provider thinking mode. Off by default - see buildPayload's measurements. */
  thinking?: boolean;
  /**
   * Answer client repair rounds in thinking mode. On unless set to false.
   * @remarks On CADPrompt (2026-10-10) the plain model returned the failing
   *   script byte for byte on 11 of 11 parts a cut had severed; in thinking mode
   *   it rebuilt 10 of them as one solid. Repairs are a small share of requests,
   *   so the latency lands only where a part already failed.
   */
  repairThinking?: boolean;
  /** Wall clock for one thinking repair call before falling back to plain mode. */
  repairThinkingTimeoutMs?: number;
  limits?: Partial<CadLimits>;
  fetchImpl?: typeof fetch;
  /** Jev, for library selection. Without it every request sees the whole catalog. */
  jev?: JevConfig;
}

/**
 * A geometric-gate failure the CLIENT reported after running the kernel.
 * @remarks A hint fed to the prompt, never a verdict. The server cannot see the
 *   geometry, so it re-runs the static gates on whatever comes back regardless
 *   of what the client claims - see the spec's section 6.
 */
export interface CadFailure {
  gate: string;
  error: string;
}

export interface CadGenerateInput extends TurnInput {
  repairAttempts?: number;
  /** Failures from a client-side kernel run; turns this into a repair round. */
  failures?: CadFailure[];
  signal?: AbortSignal;
}

export interface CadDiagnostics {
  /** Catalog entries the generation prompt documented, and how they were chosen. */
  selection: Omit<LibrarySelection, "tokens"> & { jevTokens: TokenUsage };
  attempts: AttemptRecord[];
  durationMs: number;
  tokens: TokenUsage;
}

/**
 * One generated design.
 * @remarks There is deliberately NO `validation` field. The server ran no
 *   kernel, so it cannot claim the design is geometrically sound; a field named
 *   `validation` that no longer validates is a trap for whoever reads the API
 *   next. What the server does guarantee is that the design passed every static
 *   gate, which is what `diagnostics.attempts` records.
 */
export interface CadGenerateResult {
  design: CadDesign;
  runtime: { contractVersion: number; preludeVersion: string };
  /** Which provider produced the design, so a client can log or attribute it. */
  provider: { id: string; model: string };
  /**
   * Credits owed for any ported design this part derives from.
   * @remarks Computed from the helpers the script CALLS, never from the model,
   *   so it cannot be forgotten or over-claimed. Empty when nothing licensed is
   *   involved - standard dimensions and our own maths are facts, not works.
   *   This is the field the UI shows the user.
   */
  attribution: Attribution[];
  diagnostics: CadDiagnostics;
}

export interface CadGenerator {
  generate(input: CadGenerateInput): Promise<CadGenerateResult>;
}

const DEFAULTS: CadLimits = {
  maxRepairAttempts: 3,
};

/** Model the provider falls back to when the caller names none. */
export const DEFAULT_CAD_MODEL = "deepseek-flash";

/**
 * Builds the opening message list for one request.
 * @remarks A client-driven repair is the same conversation plus one turn: the
 *   design the client actually built, and what its kernel found wrong with it.
 *   Reusing buildRepairMessages means a client-reported failure is rendered by
 *   the same formatter - including its redundancy dedupe - as one the server
 *   found itself, so the two paths cannot drift apart.
 */
function openingMessages(input: CadGenerateInput): LlmMessage[] {
  const failures = input.failures ?? [];
  if (failures.length === 0 || !input.priorDesign) return buildTurnMessages(input);
  // The failed design is the assistant's reply, NOT the turn's CURRENT DESIGN:
  // framed as the state to edit, under "preserve everything the user did not
  // ask to change", the model returned the failing script byte for byte.
  const { priorDesign: _failed, ...request } = input;
  return buildRepairMessages(
    buildTurnMessages(request),
    input.priorDesign,
    failures.map((f) => f.gate + ": " + f.error).join("; "),
    failures.map((f) => ({ gate: f.gate, ok: false, error: f.error })),
  );
}

/**
 * Refuses a request parametric CAD cannot model, before DeepSeek is paid for it.
 * @throws CadRequestUnsuitable when Jev judged it below SUITABILITY_THRESHOLD.
 */
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

/** The selection as diagnostics report it: Jev's tokens named apart from DeepSeek's. */
function selectionDiagnostics(selection: LibrarySelection): CadDiagnostics["selection"] {
  const { tokens, ...rest } = selection;
  return { ...rest, jevTokens: tokens };
}

/**
 * Thinking-mode repair calls that take longer than this fall back to plain mode.
 * @remarks Thinking answered in a median 19 s (p90 50 s) on CADPrompt, but 9% of
 *   calls ran into the provider's 120 s limit. A repair that fails on a timeout
 *   would lose a part plain mode might still have fixed.
 */
const REPAIR_THINKING_TIMEOUT_MS = 90000;

/**
 * Retries a timed-out call on the fallback client.
 * @remarks Only a timeout falls back: a caller's abort, an auth failure or a
 *   rate limit would fail the same way on the second client.
 */
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

/**
 * Builds the CAD generator.
 * @remarks repairAttempts is capped by the configured maximum, so a caller
 *   cannot buy more provider spend than the server allows.
 */
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

      // Stage one: which catalog entries this request needs (see select.ts).
      const selection = await selectLibraries(jev, input, input.signal);
      refuseUnsuitable(selection);
      const turn = { ...input, libraries: selection.libraries, libraryFit: selection.fit };

      const outcome = await generateWithRepair({
        client: input.failures?.length ? repairClient : client,
        parseDesign,
        buildRepairMessages,
        // Static only, and deliberately so: the server never runs the kernel.
        // See validateStatic for why, and for the measurement that shows the
        // server-side proxy disagreeing with the delivered part.
        // The prompt feeds the required-helper gate (CatalogEntry.requires).
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
