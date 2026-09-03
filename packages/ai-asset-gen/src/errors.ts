import type { GenerationCapability } from "./types.ts";

/** Thrown when a provider is asked to do something it does not support. */
export class UnsupportedCapabilityError extends Error {
  constructor(providerId: string, capability: GenerationCapability) {
    super(providerId + " does not support \"" + capability + "\"");
    this.name = "UnsupportedCapabilityError";
  }
}

/**
 * Gates a capability, throwing UnsupportedCapabilityError when the provider
 * does not declare it.
 * @remarks A provider's declared capability set is the single source of truth.
 */
export function requireCapability(
  providerId: string,
  capabilities: ReadonlySet<GenerationCapability>,
  capability: GenerationCapability,
): void {
  if (!capabilities.has(capability)) {
    throw new UnsupportedCapabilityError(providerId, capability);
  }
}
