/**
 * Provider registry — provider construction by injection.
 * @remarks The composition root supplies the factories, so adding a provider
 *   never modifies this module (or the facade's default convenience).
 */
import type { GenerationConfig, GenerationProvider } from "./facade.ts";

export type ProviderFactory = (config: GenerationConfig) => GenerationProvider;

export interface ProviderRegistry {
  resolve(id: string, config: GenerationConfig): GenerationProvider;
}

export function createProviderRegistry(
  factories: Readonly<Record<string, ProviderFactory>>,
): ProviderRegistry {
  return {
    resolve(id, config) {
      const factory = factories[id];
      if (!factory) throw new Error("unknown generation provider: " + id);
      return factory(config);
    },
  };
}
