/**
 * @arbesk/ai-asset-gen — public API.
 */
export { createGenerationProvider } from "./facade.ts";
export type { GenerationProvider, GenerationConfig } from "./facade.ts";
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
