import { CONTRACT_VERSION, PRELUDE_VERSION } from "@arbesk/cad-gen";
import { CadDesignError } from "@arbesk/cad-gen/errors.js";

describe("@arbesk/cad-gen package wiring", () => {
  it("exposes the contract version", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it("exposes a non-empty prelude version", () => {
    expect(typeof PRELUDE_VERSION).toBe("string");
    expect(PRELUDE_VERSION.length).toBeGreaterThan(0);
  });

  it("exposes the error hierarchy", () => {
    const err = new CadDesignError("bad");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CadDesignError");
  });
});
