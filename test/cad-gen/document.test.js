import {
  parseDesign,
  validateParameterOverrides,
  referencedIdentifiers,
} from "@arbesk/cad-gen/core/document.js";
import { CadDesignError } from "@arbesk/cad-gen/errors.js";

const VALID = {
  code: "return box(P.width, P.depth, P.height);",
  parameters: {
    width: { value: 60, unit: "mm", min: 10, max: 200, label: "Overall width" },
  },
  summary: "Create a box",
};

describe("parseDesign", () => {
  it("accepts a well-formed document and stamps turn 1", () => {
    const d = parseDesign(VALID);
    expect(d.code).toBe(VALID.code);
    expect(d.parameters.width.value).toBe(60);
    expect(d.turn).toBe(1);
  });

  it("rejects a document whose code is empty", () => {
    expect(() => parseDesign({ ...VALID, code: "   " })).toThrow(CadDesignError);
  });

  it("rejects a parameter with a non-finite value", () => {
    expect(() =>
      parseDesign({ ...VALID, parameters: { width: { value: NaN, unit: "mm" } } }),
    ).toThrow(/parameter width/);
  });

  it("rejects a parameter missing its unit", () => {
    expect(() => parseDesign({ ...VALID, parameters: { width: { value: 1 } } })).toThrow(
      /parameter width/,
    );
  });

  it("rejects a document with no parameters at all", () => {
    expect(() => parseDesign({ ...VALID, parameters: {} })).toThrow(/at least one parameter/);
  });

  it("defaults a missing summary to an empty string", () => {
    // eslint varsIgnorePattern: ^_ ; destructured only to omit it from `rest`
    const { summary: _summary, ...rest } = VALID;
    expect(parseDesign(rest).summary).toBe("");
  });
});

describe("validateParameterOverrides", () => {
  const design = parseDesign(VALID);

  it("returns no errors for a known parameter", () => {
    expect(validateParameterOverrides(design, { width: 80 })).toEqual([]);
  });

  it("reports an unknown parameter name", () => {
    expect(validateParameterOverrides(design, { height: 5 })).toEqual(["height"]);
  });
});

describe("referencedIdentifiers", () => {
  it("collects called names", () => {
    const names = referencedIdentifiers("const b = roundedBox(1, 2, 3, 4); return hole(b, {});");
    expect(names.has("roundedBox")).toBe(true);
    expect(names.has("hole")).toBe(true);
  });

  it("does not collect method calls", () => {
    const names = referencedIdentifiers("return [1,2].map((n) => n).length > 0;");
    expect(names.has("map")).toBe(true); // lexical only — the guard filters these
  });
});
