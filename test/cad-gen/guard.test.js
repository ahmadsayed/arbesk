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
