/**
 * @arbesk/ai-asset-gen — public API.
 */
export { createGenerationProvider } from "./facade.ts";
export type { GenerationProvider, GenerationConfig } from "./facade.ts";
export { createProviderRegistry } from "./registry.ts";
export type { ProviderFactory, ProviderRegistry } from "./registry.ts";
export { UnsupportedCapabilityError, requireCapability } from "./errors.ts";
export type {
  GenerationCapability,
  SourceRef,
  MultiviewView,
  MultiviewImage,
  TaskStatus,
  GenerationStatus,
  GenerationBalance,
} from "./types.ts";
export { TripoApiError } from "./providers/tripo.ts";
export { createMockProvider } from "./providers/mock-provider.ts";
export { createTripoProvider } from "./providers/tripo-provider.ts";
export { createCadProvider, cadWireResult } from "./providers/cad-provider.ts";
export type { CadProviderOptions, CadSettleOutcome, CadSettleError } from "./providers/cad-provider.ts";
