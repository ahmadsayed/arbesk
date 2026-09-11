/**
 * Backend composition root for CAD generation.
 * @remarks Wires the DeepSeek client, the prompt, the kernel-backed validator
 *   and the repair loop. This is the only entry the Express route needs.
 */
import type { CadDesign, CadStats, TokenUsage } from "../types.ts";
import { CONTRACT_VERSION, PRELUDE_VERSION } from "../core/contract.ts";
import { PRELUDE_NAMES } from "../core/prelude.ts";
import { parseDesign } from "../core/document.ts";
import { validateDesign } from "./validate.ts";
import { createDeepSeekClient } from "./deepseek.ts";
import { buildTurnMessages, buildRepairMessages } from "./prompt.ts";
import type { TurnInput } from "./prompt.ts";
import { generateWithRepair } from "./repair.ts";
import type { AttemptRecord } from "./repair.ts";

export interface CadLimits {
  timeoutMs: number;
  maxTriangles: number;
  maxRepairAttempts: number;
  /** Host-supplied directory holding manifold.wasm. */
  wasmDir?: string;
}

export interface CadGenConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Provider thinking mode. Off by default - see buildPayload's measurements. */
  thinking?: boolean;
  limits?: Partial<CadLimits>;
  fetchImpl?: typeof fetch;
}

export interface CadGenerateInput extends TurnInput {
  repairAttempts?: number;
  signal?: AbortSignal;
}

export interface CadDiagnostics {
  attempts: AttemptRecord[];
  durationMs: number;
  tokens: TokenUsage;
}

export interface CadGenerateResult {
  design: CadDesign;
  runtime: { contractVersion: number; preludeVersion: string };
  validation: { mode: "kernel"; ok: true; stats: CadStats };
  diagnostics: CadDiagnostics;
}

export interface CadGenerator {
  generate(input: CadGenerateInput): Promise<CadGenerateResult>;
}

const DEFAULTS: CadLimits = {
  timeoutMs: 10000,
  maxTriangles: 200000,
  maxRepairAttempts: 3,
};

/**
 * Builds the CAD generator.
 * @remarks repairAttempts is capped by the configured maximum, so a caller
 *   cannot buy more provider spend than the server allows.
 */
export function createCadGenerator(config: CadGenConfig): CadGenerator {
  const limits: CadLimits = { ...DEFAULTS, ...config.limits };
  const client = createDeepSeekClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    model: config.model ?? "deepseek-flash",
    ...(config.thinking ? { thinking: true } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });

  return {
    async generate(input) {
      const started = Date.now();
      const attempts = input.repairAttempts
        ? Math.min(input.repairAttempts, limits.maxRepairAttempts)
        : limits.maxRepairAttempts;

      const outcome = await generateWithRepair({
        client,
        parseDesign,
        buildRepairMessages,
        validate: (design) => validateDesign(design, {
          preludeNames: PRELUDE_NAMES,
          limits: {
            timeoutMs: limits.timeoutMs,
            maxTriangles: limits.maxTriangles,
            ...(limits.wasmDir ? { wasmDir: limits.wasmDir } : {}),
          },
        }),
      }, buildTurnMessages(input), attempts, input.signal);

      return {
        design: { ...outcome.design, turn: (input.priorDesign?.turn ?? 0) + 1 },
        runtime: { contractVersion: CONTRACT_VERSION, preludeVersion: PRELUDE_VERSION },
        validation: { mode: "kernel", ok: true, stats: outcome.stats as CadStats },
        diagnostics: {
          attempts: outcome.attempts,
          durationMs: Date.now() - started,
          tokens: outcome.tokens,
        },
      };
    },
  };
}
