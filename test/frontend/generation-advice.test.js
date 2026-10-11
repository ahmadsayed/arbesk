import { describe, expect, test } from "bun:test";

const { decideGenerationPlan, CONFIG_BUNDLES } = await import("../../frontend/src/js/ui/generation-advice.js");

/** An advice reading as POST /api/v1/generation-advice returns it. */
function advice({
  provider = "tripo3d",
  providerConfidence = 0.9,
  providerProbabilities = null,
  config = "balanced",
  configConfidence = 0.9,
  configProbabilities = null,
} = {}) {
  return {
    provider,
    providerConfidence,
    providerProbabilities: providerProbabilities ?? { [provider]: providerConfidence },
    config,
    configConfidence,
    configProbabilities: configProbabilities ?? { [config]: configConfidence },
  };
}

const AUTO = { cadAvailable: true, provider: "auto" };

describe("decideGenerationPlan", () => {
  test("no advice keeps the fallback route", () => {
    expect(decideGenerationPlan(null, AUTO)).toEqual({ kind: "fallback" });
  });

  test("a confident CAD reading with CAD available routes to CAD", () => {
    const plan = decideGenerationPlan(
      advice({ provider: "cad", providerConfidence: 0.9 }),
      AUTO,
    );
    expect(plan).toEqual({ kind: "auto", provider: "cad" });
  });

  test("CAD at 0.8 exactly still routes (threshold is inclusive)", () => {
    const plan = decideGenerationPlan(
      advice({ provider: "cad", providerConfidence: 0.8 }),
      AUTO,
    );
    expect(plan).toEqual({ kind: "auto", provider: "cad" });
  });

  test("a confident Tripo reading with a confident config auto-picks the config", () => {
    const plan = decideGenerationPlan(
      advice({ config: "game-ready", configConfidence: 0.85 }),
      AUTO,
    );
    expect(plan).toEqual({ kind: "auto", provider: "tripo3d", configId: "game-ready" });
  });

  test("a confident Tripo provider with an unsure config asks", () => {
    const plan = decideGenerationPlan(
      advice({ providerConfidence: 0.95, configConfidence: 0.5 }),
      AUTO,
    );
    expect(plan.kind).toBe("ask");
  });

  test("an unsure provider reading asks", () => {
    const plan = decideGenerationPlan(
      advice({ providerConfidence: 0.5, configConfidence: 0.95 }),
      AUTO,
    );
    expect(plan.kind).toBe("ask");
  });

  test("a confident CAD reading with CAD unavailable reroutes to the Tripo advice", () => {
    const plan = decideGenerationPlan(
      advice({ provider: "cad", providerConfidence: 0.95, config: "clean-topo", configConfidence: 0.9 }),
      { cadAvailable: false, provider: "auto" },
    );
    expect(plan).toEqual({ kind: "auto", provider: "tripo3d", configId: "clean-topo" });
  });

  test("CAD unavailable and the config reading unsure asks without a CAD option", () => {
    const plan = decideGenerationPlan(
      advice({ provider: "cad", providerConfidence: 0.95, configConfidence: 0.4 }),
      { cadAvailable: false, provider: "auto" },
    );
    expect(plan.kind).toBe("ask");
    expect(plan.options.some((o) => o.value === "cad")).toBe(false);
  });

  test("ask offers the top options by probability and always includes balanced", () => {
    const plan = decideGenerationPlan(
      advice({
        providerConfidence: 0.5,
        providerProbabilities: { cad: 0.7, tripo3d: 0.3 },
        configConfidence: 0.5,
        configProbabilities: { "hero-detail": 0.6, "fast-draft": 0.3, balanced: 0.05, "game-ready": 0.05 },
      }),
      AUTO,
    );
    expect(plan.kind).toBe("ask");
    expect(plan.options.map((o) => o.value)).toEqual([
      "cad",
      "tripo3d:hero-detail",
      "tripo3d:fast-draft",
      "tripo3d:balanced", // rides along even though it ranked 4th
    ]);
    expect(plan.options[0].recommended).toBe(true);
    expect(plan.options.slice(1).every((o) => !o.recommended)).toBe(true);
  });

  test("ask keeps balanced inside the top three without duplicating it", () => {
    const plan = decideGenerationPlan(
      advice({
        providerConfidence: 0.5,
        configConfidence: 0.5,
        configProbabilities: { balanced: 0.7, "clean-topo": 0.2, "hero-detail": 0.1 },
      }),
      { cadAvailable: false, provider: "auto" },
    );
    expect(plan.kind).toBe("ask");
    expect(plan.options.map((o) => o.value)).toEqual([
      "tripo3d:balanced",
      "tripo3d:clean-topo",
      "tripo3d:hero-detail",
    ]);
  });

  test("a manual Tripo pick applies a confident config reading (provider question skipped)", () => {
    const plan = decideGenerationPlan(
      advice({ provider: "cad", providerConfidence: 1, config: "hero-detail", configConfidence: 0.9 }),
      { cadAvailable: true, provider: "tripo3d" },
    );
    expect(plan).toEqual({ kind: "auto", provider: "tripo3d", configId: "hero-detail" });
  });

  test("a manual Tripo pick with an unsure config falls back to plain quality", () => {
    const plan = decideGenerationPlan(
      advice({ configConfidence: 0.3 }),
      { cadAvailable: true, provider: "tripo3d" },
    );
    expect(plan).toEqual({ kind: "fallback" });
  });

  test("a manual Tripo pick with no advice falls back", () => {
    expect(decideGenerationPlan(null, { cadAvailable: true, provider: "tripo3d" }))
      .toEqual({ kind: "fallback" });
  });
});

describe("CONFIG_BUNDLES", () => {
  test("carry the exact generation payload fields per bundle id", () => {
    expect(CONFIG_BUNDLES["fast-draft"]).toMatchObject({
      label: "Fast draft",
      fields: {
        tripoModel: "v3.1-20260211",
        textureQuality: "fast",
        textureVersion: "v3.5-20260815",
        delight: true,
      },
    });
    expect(CONFIG_BUNDLES.balanced.fields).toEqual({
      tripoModel: "v3.1-20260211",
      textureQuality: "standard",
    });
    expect(CONFIG_BUNDLES["hero-detail"].fields).toEqual({
      tripoModel: "v3.1-20260211",
      textureQuality: "detailed",
    });
    expect(CONFIG_BUNDLES["game-ready"].fields).toEqual({
      tripoModel: "P1-20260311",
      textureQuality: "standard",
      faceLimit: 5000,
    });
    expect(CONFIG_BUNDLES["clean-topo"].fields).toEqual({
      tripoModel: "P2-20260801",
      textureQuality: "standard",
    });
  });
});
