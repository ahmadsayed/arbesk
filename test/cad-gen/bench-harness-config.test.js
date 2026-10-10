import { describe, expect, it } from "bun:test";
import { generatorConfigFrom } from "../../scripts/lib/cad-harness.mjs";

describe("generatorConfigFrom", () => {
  it("reads the same variables as the API route", () => {
    const config = generatorConfigFrom({
      DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: "m", CAD_THINKING: "false", CAD_MAX_REPAIR_ATTEMPTS: "5", CAD_MODEL: "ignored",
    });
    expect(config).toMatchObject({ apiKey: "k", model: "m", thinking: false, limits: { maxRepairAttempts: 5 } });
  });

  it("defaults the repair bound like the route", () => {
    expect(generatorConfigFrom({ DEEPSEEK_API_KEY: "k" }).limits).toEqual({ maxRepairAttempts: 3 });
  });

  it("refuses an unusable repair bound, naming the variable", () => {
    expect(() => generatorConfigFrom({ DEEPSEEK_API_KEY: "k", CAD_MAX_REPAIR_ATTEMPTS: "0" }))
      .toThrow("CAD_MAX_REPAIR_ATTEMPTS");
  });
});
