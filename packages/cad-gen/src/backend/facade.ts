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
import { createDeepSeekClient } from "./deepseek.ts";
import type { LlmMessage } from "./deepseek.ts";
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

/**
 * Builds the opening message list for one request.
 * @remarks A client-driven repair is the same conversation plus one turn: the
 *   design the client actually built, and what its kernel found wrong with it.
 *   Reusing buildRepairMessages means a client-reported failure is rendered by
 *   the same formatter - including its redundancy dedupe - as one the server
 *   found itself, so the two paths cannot drift apart.
 */
function openingMessages(input: CadGenerateInput): LlmMessage[] {
  const base = buildTurnMessages(input);
  const failures = input.failures ?? [];
  if (failures.length === 0 || !input.priorDesign) return base;
  return buildRepairMessages(
    base,
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
 * Builds the CAD generator.
 * @remarks repairAttempts is capped by the configured maximum, so a caller
 *   cannot buy more provider spend than the server allows.
 */
export function createCadGenerator(config: CadGenConfig): CadGenerator {
  const limits: CadLimits = { ...DEFAULTS, ...config.limits };
  const model = config.model ?? "deepseek-flash";
  const client = createDeepSeekClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    model,
    ...(config.thinking ? { thinking: true } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });

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
        client,
        parseDesign,
        buildRepairMessages,
        // Static only, and deliberately so: the server never runs the kernel.
        // See validateStatic for why, and for the measurement that shows the
        // server-side proxy disagreeing with the delivered part.
        validate: async (design) => validateStatic(design, PRELUDE_NAMES),
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
