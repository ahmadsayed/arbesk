import { guardScript } from "@arbesk/cad-gen/core/guard.js";

const PRELUDE = ["box", "cylinder", "hole", "roundedBox", "filletEdges", "bbox", "volume"];
const check = (code) => guardScript(code, PRELUDE);

describe("guardScript — denylist", () => {
  const denied = [
    ["dynamic import", "import('node:fs');"],
    ["require", "const fs = require('fs');"],
    ["eval", "eval('1+1');"],
    ["Function", "const f = new Function('return 1');"],
    ["process", "process.exit(0);"],
    ["globalThis", "globalThis.fetch('http://x');"],
    ["fetch", "fetch('http://x');"],
    ["child_process", "const s = child_process.spawn;"],
    ["WebAssembly", "WebAssembly.instantiate(1);"],
    ["constructor escape", "({}).constructor.constructor('return 1')();"],
    ["unbounded loop", "while (true) {}"],
    ["__proto__", "const p = x.__proto__;"],
    ["process member access", "return process.mainModule.require('fs');"],
    ["globalThis member access", "return globalThis.fetch('http://x');"],
    ["self member access", "return self.importScripts('x');"],
  ];

  it.each(denied)("rejects %s", (_label, code) => {
    expect(check("return box(1,1,1); " + code).ok).toBe(false);
  });
});

describe("guardScript — structure", () => {
  it("accepts a well-formed script", () => {
    expect(check("const b = roundedBox(60, 40, 10, 2);\nreturn hole(b, { diameter: 6 });").ok).toBe(true);
  });

  it("rejects an empty script", () => {
    expect(check("   ").reason).toBe("EMPTY_CODE");
  });

  it("rejects a script with no return", () => {
    expect(check("const b = box(1, 1, 1);").reason).toBe("NO_RETURN");
  });

  it("rejects a call to an unknown prelude helper", () => {
    const r = check("return warpDrive(1, 2, 3);");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_HELPER");
    expect(r.detail).toContain("warpDrive");
  });

  it("allows method calls on values", () => {
    expect(check("const xs = [1,2,3].map((n) => n * 2);\nreturn box(xs[0], 1, 1);").ok).toBe(true);
  });

  it("allows locally declared functions", () => {
    expect(check("function helper(w) { return box(w, w, w); }\nreturn helper(5);").ok).toBe(true);
  });

  it("allows if/for control flow without mistaking keywords for helpers", () => {
    const code = [
      "let out = box(P.w, P.d, P.h);",
      "if (P.count > 1) {",
      "  for (let i = 0; i < P.count; i++) {",
      "    out = out.subtract(hole(out, { diameter: 3, axis: 'z', at: [i * 10, 0] }));",
      "  }",
      "}",
      "return out;",
    ].join("\n");
    const r = check(code);
    expect(r.ok).toBe(true);
  });

  it("allows engineering prose in comments", () => {
    const code = [
      "// self-tapping screw boss, 4mm mill process",
      "// global dimensions are in mm",
      "return box(P.w, P.d, P.h);",
    ].join("\n");
    expect(check(code).ok).toBe(true);
  });

  it("allows a comment describing a window frame", () => {
    const code = [
      "// window frame profile, extruded and filleted",
      "return roundedBox(P.w, P.d, P.h, 2);",
    ].join("\n");
    expect(check(code).ok).toBe(true);
  });
});

// Regression, found against the live DeepSeek API (2026-09-11): the bare-call
// heuristic matched a word followed by "(" inside a COMMENT, so the guard
// rejected valid scripts. The model's own workaround was to delete its
// comments ("Removed comment text that tripped the helper guard"), which
// corrupts the artifact we ship.
describe("guardScript - prose and string literals", () => {
  const prose = [
    ["a parenthesised aside", "// hole through the vertical leg (normal = X)"],
    ["two asides", "// upright member (Z) and base member (X)"],
    ["an aside naming a fastener", "// self-tapping screw boss (M3)"],
    ["an aside mid-sentence", "// the plate (80 mm wide) is extruded to thickness"],
    ["a parenthesised abbreviation", "// mill finish (Ra 3.2) on all faces"],
    ["a block comment aside", "/* the hub (left) carries the load */"],
  ];

  it.each(prose)("allows %s in a comment", (_label, comment) => {
    expect(check(comment + "\nreturn box(P.w, P.d, P.h);").ok).toBe(true);
  });

  it("allows a parenthesised aside inside a string literal", () => {
    expect(check("const note = 'the leg (left)';\nreturn box(1, 1, 1);").ok).toBe(true);
  });

  it("allows an aside in a comment above a real call to the same word", () => {
    const code = [
      "// the leg (along +X) is the long one",
      "const leg = box(P.l, P.w, P.t);",
      "return leg;",
    ].join("\n");
    expect(check(code).ok).toBe(true);
  });

  it("still rejects a real call to an unknown helper", () => {
    const r = check("return mysteryHelper(1);");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_HELPER");
    expect(r.detail).toBe("mysteryHelper");
  });

  it("still rejects an unknown helper called in code with prose around it", () => {
    const code = [
      "// build the boss (M3)",
      "return mysteryHelper(1);",
    ].join("\n");
    const r = check(code);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("mysteryHelper");
  });

  it("still rejects a denied construct that is real code", () => {
    expect(check("// avoid eval() here\nreturn eval('1');").ok).toBe(false);
  });

  it("does not let a comment satisfy the return requirement", () => {
    const r = check("// this returns the finished part");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NO_RETURN");
  });

  it("does not let a string literal satisfy the return requirement", () => {
    expect(check("const s = 'return the part';").ok).toBe(false);
  });

  it("keeps scanning after an unterminated string (fail-closed)", () => {
    const r = check("const s = 'oops\nreturn eval('1');");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DENIED_CONSTRUCT");
  });
});
