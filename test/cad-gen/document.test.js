import { describe, expect, it } from "bun:test";
import {
  parseDesign,
  validateParameterOverrides,
  referencedIdentifiers,
  usedParameterNames,
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

describe("parseDesign - colour parameters", () => {
  const withColour = (c) => ({
    code: "return box(P.w, 1, 1);",
    parameters: { w: { value: 1, unit: "mm" }, c },
  });

  it("parses a colour parameter and lowercases it", () => {
    const d = parseDesign(withColour({ type: "color", value: "#D33A2C" }));
    expect(d.parameters.c).toEqual({ type: "color", value: "#d33a2c" });
  });

  it("keeps a colour parameter's label", () => {
    const d = parseDesign(withColour({ type: "color", value: "#000000", label: "Lid colour" }));
    expect(d.parameters.c).toEqual({ type: "color", value: "#000000", label: "Lid colour" });
  });

  it("rejects bad hex", () => {
    for (const value of ["red", "#d33", 3]) {
      expect(() => parseDesign(withColour({ type: "color", value }))).toThrow(/\bc\b/);
    }
  });

  it("rejects unit/min/max on a colour", () => {
    for (const extra of [{ unit: "mm" }, { min: 0 }, { max: 1 }]) {
      expect(() => parseDesign(withColour({ type: "color", value: "#000000", ...extra }))).toThrow(CadDesignError);
    }
  });

  it("rejects an unknown type", () => {
    expect(() => parseDesign(withColour({ type: "angle", value: 1 }))).toThrow(CadDesignError);
  });

  it("length parameters unchanged", () => {
    expect(parseDesign(VALID).parameters).toEqual({
      width: { value: 60, unit: "mm", min: 10, max: 200, label: "Overall width" },
    });
    expect(parseDesign({ ...VALID, parameters: { w: { type: "length", value: 2, unit: "mm" } } }).parameters)
      .toEqual({ w: { value: 2, unit: "mm" } });
  });
});

describe("validateParameterOverrides - kinds", () => {
  it("override kind mismatch", () => {
    const design = parseDesign({
      code: "return box(P.w, 1, 1);",
      parameters: { w: { value: 1, unit: "mm" }, c: { type: "color", value: "#000000" } },
    });
    expect(validateParameterOverrides(design, { c: 5, w: "#000000" })).toEqual(["c", "w"]);
    expect(validateParameterOverrides(design, { c: "#ffffff", w: 3 })).toEqual([]);
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

// Regression: this scan reads *code*, but comments and string literals were
// being scanned as if they were code. "leg (" in a comment is not a call.
describe("referencedIdentifiers - ignores non-code", () => {
  it("ignores a parenthesised aside in a comment", () => {
    const names = referencedIdentifiers("// hole through the vertical leg (normal = X)\nreturn box(1, 1, 1);");
    expect([...names]).toEqual(["box"]);
  });

  it("ignores a parenthesised aside in a string literal", () => {
    const names = referencedIdentifiers("const note = 'the leg (left)';\nreturn box(1, 1, 1);");
    expect([...names]).toEqual(["box"]);
  });

  it("ignores a name called inside a template literal", () => {
    const tick = String.fromCharCode(96);
    const code = "const t = " + tick + "leg (" + tick + ";\nreturn box(1, 1, 1);";
    expect([...referencedIdentifiers(code)]).toEqual(["box"]);
  });

  it("still collects real calls", () => {
    const names = referencedIdentifiers("return hole(box(1,1,1), {});");
    expect([...names].sort()).toEqual(["box", "hole"]);
  });
});

describe("usedParameterNames", () => {
  it("dot access", () => {
    expect(usedParameterNames("return box(P.width, PARAMETERS.depth, P.width)"))
      .toEqual({ names: ["width", "depth"], dynamic: false });
  });

  it("bracket literal", () => {
    expect(usedParameterNames("return box(P[\"a\"], P['b'], 1)"))
      .toEqual({ names: ["a", "b"], dynamic: false });
  });

  it("destructuring with alias and default", () => {
    expect(usedParameterNames("const { a, b: bee, c = 2 } = P;\nreturn box(a, bee, c);"))
      .toEqual({ names: ["a", "b", "c"], dynamic: false });
  });

  it("ignores comments and strings", () => {
    expect(usedParameterNames("// P.ghost\nconst s = 'P.fake'; return box(P.real, 1, 1)"))
      .toEqual({ names: ["real"], dynamic: false });
  });

  it("ignores a property that happens to be named P", () => {
    expect(usedParameterNames("const o = M.P; return box(P.w, 1, 1)"))
      .toEqual({ names: ["w"], dynamic: false });
  });

  it("computed key marks dynamic", () => {
    expect(usedParameterNames("const k = 'w'; return box(P[k], 1, 1)").dynamic).toBe(true);
  });

  it("aliasing P marks dynamic", () => {
    expect(usedParameterNames("const p = P; return box(p.w, 1, 1)").dynamic).toBe(true);
    expect(usedParameterNames("f(PARAMETERS); return box(1, 1, 1)").dynamic).toBe(true);
    expect(usedParameterNames("const { ...rest } = P; return box(rest.w, 1, 1)").dynamic).toBe(true);
  });
});
