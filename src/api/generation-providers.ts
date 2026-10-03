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
import type { CadGenerator } from "@arbesk/cad-gen/backend/index.js";
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
