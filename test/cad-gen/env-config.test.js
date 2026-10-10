import { describe, expect, it } from "bun:test";
import {
  DEFAULT_REPAIR_ATTEMPTS, cadGenConfigFromEnv, isThinkingEnabled, readBound,
} from "../../packages/cad-gen/src/backend/env-config.ts";

describe("readBound", () => {
  it("falls back when unset or blank, parses positive integers, returns the raw string otherwise", () => {
    expect(readBound({}, "X", 3)).toBe(3);
    expect(readBound({ X: "  " }, "X", 3)).toBe(3);
    expect(readBound({ X: "5" }, "X", 3)).toBe(5);
    for (const bad of ["0", "2.5", "-1", "x"]) expect(readBound({ X: bad }, "X", 3)).toBe(bad);
  });
});

describe("isThinkingEnabled", () => {
  it("is on only for true, 1 or yes", () => {
    for (const on of ["true", "1", "yes", " YES "]) expect(isThinkingEnabled({ CAD_THINKING: on })).toBe(true);
    for (const off of [undefined, "", "false", "0", "no", "off"]) expect(isThinkingEnabled({ CAD_THINKING: off })).toBe(false);
  });
});

describe("cadGenConfigFromEnv", () => {
  it("uses the provider defaults when only the key is set", () => {
    expect(cadGenConfigFromEnv({ DEEPSEEK_API_KEY: " k " }, { maxRepairAttempts: DEFAULT_REPAIR_ATTEMPTS }))
      .toEqual({ apiKey: "k", thinking: false, limits: { maxRepairAttempts: 3 } });
  });

  it("reads the model, base URL, thinking and Jev settings, trimmed", () => {
    const fetchImpl = /** @type {any} */ (() => {});
    const config = cadGenConfigFromEnv({
      DEEPSEEK_API_KEY: "k", DEEPSEEK_MODEL: " m ", DEEPSEEK_BASE_URL: " https://x ", CAD_THINKING: "yes",
      JEV_API_KEY: " j ", JEV_BASE_URL: " https://jev ", JEV_MODEL: " jm ",
    }, { maxRepairAttempts: 2 }, fetchImpl);
    expect(config).toEqual({
      apiKey: "k", model: "m", baseUrl: "https://x", thinking: true, limits: { maxRepairAttempts: 2 }, fetchImpl,
      jev: { apiKey: "j", baseUrl: "https://jev", model: "jm", fetchImpl },
    });
  });

  it("turns repair-round thinking off only for an explicit false, 0, no or off", () => {
    for (const off of ["false", "0", "no", " OFF "]) {
      expect(cadGenConfigFromEnv({ DEEPSEEK_API_KEY: "k", CAD_REPAIR_THINKING: off }, {}).repairThinking).toBe(false);
    }
    for (const on of [undefined, "", "true", "yes"]) {
      expect(cadGenConfigFromEnv({ DEEPSEEK_API_KEY: "k", CAD_REPAIR_THINKING: on }, {})).not.toHaveProperty("repairThinking");
    }
  });

  it("leaves Jev out when its key is blank", () => {
    expect(cadGenConfigFromEnv({ DEEPSEEK_API_KEY: "k", JEV_API_KEY: "  " }, {})).not.toHaveProperty("jev");
  });
});
