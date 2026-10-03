/**
 * Provider registry: construction by injection.
 */
import { describe, expect, it } from "bun:test";
import {
  createGenerationProvider,
  createMockProvider,
  createProviderRegistry,
} from "@arbesk/ai-asset-gen/index.js";

describe("createProviderRegistry", () => {
  it("resolves a registered id through its factory with the config passed through", () => {
    const registry = createProviderRegistry({ mock: (config) => createMockProvider(config) });
    const provider = registry.resolve("mock", { id: "mock", capabilities: ["text-to-3d"] });
    expect(provider.id).toBe("mock");
    expect(provider.can("text-to-3d")).toBe(true);
    expect(provider.can("retopo")).toBe(false);
  });

  it("throws the historical message for an unknown id", () => {
    const registry = createProviderRegistry({});
    expect(() => registry.resolve("nope", { id: "nope", capabilities: [] }))
      .toThrow("unknown generation provider: nope");
  });
});

describe("createGenerationProvider (default registry)", () => {
  it("still resolves mock and tripo3d", () => {
    const mock = createGenerationProvider({ id: "mock", capabilities: ["text-to-3d"] });
    expect(mock.id).toBe("mock");
    const tripo = createGenerationProvider({ id: "tripo3d", apiKey: "test-key", capabilities: ["text-to-3d"] });
    expect(tripo.id).toBe("tripo3d");
  });

  it("still throws for an unknown id", () => {
    expect(() => createGenerationProvider({ id: "cad", capabilities: ["text-to-3d"] }))
      .toThrow("unknown generation provider: cad");
  });
});
