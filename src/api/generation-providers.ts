/**
 * Composition root for the "cad" generation provider.
 * @remarks Reuses the cad routes' cadConfigFromEnv so the unified generations
 *   path and /api/v1/cad/* share one environment vocabulary and one quota
 *   regime. The route owns metering: it supplies onSettle (release the cad
 *   slot; refund CAD_REQUEST_UNSUITABLE) because the slot token only exists
 *   after admission.
 */
import type { GenerationProvider } from "@arbesk/ai-asset-gen/facade.js";
import { createCadProvider } from "@arbesk/ai-asset-gen/index.js";
import type { CadSettleOutcome } from "@arbesk/ai-asset-gen/index.js";
import type { GenerationCapability } from "@arbesk/ai-asset-gen/types.js";
import type { CadGenerator, CadGenerateResult } from "@arbesk/cad-gen/backend/index.js";
import { CadRequestUnsuitable, PRELUDE_VERSION } from "@arbesk/cad-gen/index.js";
import type { CadDesign } from "@arbesk/cad-gen/index.js";
import { cadConfigFromEnv } from "./routes/cad.ts";
import type { CadConfigOutcome } from "./routes/cad.ts";

/** Same injection surface as CadRouteDeps (tests inject a stub generator). */
export interface GenerationProvidersDeps {
  generator?: CadGenerator;
  quotaStatePath?: string;
  fetchImpl?: typeof fetch;
}

/** The env-decided runtime config, or the 503 refusal (mirrors the cad routes). */
export function resolveCadRuntime(deps: GenerationProvidersDeps = {}): CadConfigOutcome {
  return cadConfigFromEnv(process.env, deps);
}

/**
 * Canned generator for CAD_MOCK_GENERATION: a deterministic parametric box that
 * passes the guard and the kernel, so dev/E2E can exercise the UI without a
 * DeepSeek key. Mirrors the MOCK_3D_GENERATION philosophy.
 * @remarks CAD_MOCK_UNSUITABLE exercises the rejection path the real facade
 *   takes for organic subjects (CadRequestUnsuitable BEFORE any model call):
 *   a prompt containing "dragon" refuses with the same error shape Jev's
 *   suitability judgement produces, so the UI's Tripo 3D retry offer is
 *   E2E-testable without a DeepSeek key.
 */
export function createMockCadGenerator(): CadGenerator {
  return {
    generate: async ({ prompt, priorDesign }): Promise<CadGenerateResult> => {
      if (process.env.CAD_MOCK_UNSUITABLE === "true" && /dragon/i.test(prompt)) {
        throw new CadRequestUnsuitable(
          "Request unsuitable for CAD generation",
          0.1,
        );
      }
      // An edit echoes the prior design one turn later (the real facade's
      // turn arithmetic), so E2E can observe that priorDesign arrived.
      const design: CadDesign = priorDesign
        ? { ...priorDesign, summary: "Mock edit: " + prompt.slice(0, 200), turn: (priorDesign.turn ?? 1) + 1 }
        : {
            code: "return box(P.width, P.depth, P.height);",
            parameters: {
              width: { value: 40, unit: "mm", min: 10, max: 200, label: "Width" },
              depth: { value: 30, unit: "mm", min: 10, max: 200, label: "Depth" },
              height: { value: 20, unit: "mm", min: 5, max: 100, label: "Height" },
            },
            summary: "Mock parametric box",
            turn: 1,
          };
      return {
        design,
        runtime: { contractVersion: 1, preludeVersion: PRELUDE_VERSION },
        provider: { id: "mock", model: "canned" },
        attribution: [],
        diagnostics: {
          selection: { libraries: [], fit: {}, source: "fallback", jevTokens: { prompt: 0, completion: 0 } },
          attempts: [{ index: 1, ok: true, gates: [] }],
          durationMs: 1,
          tokens: { prompt: 0, completion: 0 },
        },
      };
    },
  };
}

/** Binds the cad identity and the route's settle callback around a generator. */
export function createCadGenerationProvider(
  generator: CadGenerator,
  onSettle?: (taskId: string, outcome: CadSettleOutcome) => void,
  capabilities: GenerationCapability[] = ["text-to-3d"],
): GenerationProvider {
  return createCadProvider({
    config: { id: "cad", capabilities },
    generator,
    onSettle,
  });
}
