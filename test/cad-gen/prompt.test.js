import { describe, expect, it } from "bun:test";
import {
  SYSTEM_PROMPT, buildTurnMessages, buildRepairMessages,
} from "@arbesk/cad-gen/backend/prompt.js";
import { PRELUDE_NAMES } from "@arbesk/cad-gen/core/prelude.js";

const design = (summary) => ({
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary,
  turn: 1,
});

describe("SYSTEM_PROMPT - colour", () => {
  it("teaches color() and colour parameters", () => {
    expect(SYSTEM_PROMPT).toContain("color(part, hex)");
    expect(SYSTEM_PROMPT).toContain('"type": "color"');
    expect(SYSTEM_PROMPT).toContain("call color() last");
    expect(SYSTEM_PROMPT).not.toContain("PARAMETERS hold NUMBERS only.");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("documents the array return for multi-part objects", () => {
    expect(SYSTEM_PROMPT).toContain("return an ARRAY of solids, one per part");
    expect(SYSTEM_PROMPT).not.toContain("Produce ONE solid.");
  });

  it("forbids the constructs the guard rejects", () => {
    expect(SYSTEM_PROMPT).toMatch(/No imports/i);
    expect(SYSTEM_PROMPT).toMatch(/no network/i);
  });

  // Regression, from the live run: the model wrote `base.union(wall)`, which is
  // the STATIC form, and lost a whole attempt to "union is not a function".
  it("names the solid's instance methods and rules out part.union()", () => {
    for (const method of ["add(other)", "subtract(other)", "intersect(other)"]) {
      expect(SYSTEM_PROMPT).toContain(method);
    }
    expect(SYSTEM_PROMPT).toContain("NO instance .union()");
    expect(SYSTEM_PROMPT).toContain("M.union(a, b)");
  });
});

// The prompt IS the API documentation the model is prompted against, so the
// helper table and PRELUDE_NAMES must agree in BOTH directions. Asserting that
// PROMPT_HELPER_NAMES equals PRELUDE_NAMES would be vacuous - the constant is
// built from PRELUDE_NAMES - so the documented names are parsed back out of the
// prompt TEXT and compared as a set. An undocumented helper is dead API the
// model will never call; a documented helper that does not exist is exactly the
// hallucinated API call this project's static guard exists to reject.
const HELPER_TABLE_START = "AVAILABLE HELPERS";
const HELPER_TABLE_END = "OUTPUT";

/** The helper reference table, exactly as the model receives it. */
const helperTable = () => {
  const start = SYSTEM_PROMPT.indexOf(HELPER_TABLE_START);
  const end = SYSTEM_PROMPT.indexOf(HELPER_TABLE_END, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SYSTEM_PROMPT.slice(start, end);
};

/**
 * Every helper name the table documents.
 * @remarks A documented name is one that OPENS a row, or that starts a further
 *   column of one (after " / " as in rect / circle, or after the column gap as
 *   in bbox / volume). Scanning every name-paren occurrence instead would flag
 *   description words - the roundRect row's "profile (r clamped)" - as
 *   documented helpers, which is the false positive this test exists to catch
 *   in the other direction. The extraction deliberately binds on the prompt
 *   text, not on a constant derived from the same source it is checking.
 */
const documentedHelperNames = () => [
  ...new Set(
    [...helperTable().matchAll(/(?:^[ \t]*|\/\s*|\s{2,})([a-zA-Z_$][\w$]*)\s*\(/gm)]
      .map((hit) => hit[1]),
  ),
];

describe("SYSTEM_PROMPT helper table", () => {
  it("documents every helper the prelude injects", () => {
    const documented = new Set(documentedHelperNames());
    const missing = [...PRELUDE_NAMES].filter((name) => !documented.has(name)).sort();
    expect(missing).toEqual([]);
  });

  it("documents no helper the prelude does not inject", () => {
    const injected = new Set(PRELUDE_NAMES);
    const hallucinated = documentedHelperNames()
      .filter((name) => !injected.has(name)).sort();
    expect(hallucinated).toEqual([]);
  });

  it("names each prelude helper as a whole word", () => {
    // Substring matching would let "box" pass on the strength of "roundedBox".
    const words = SYSTEM_PROMPT.match(/[a-zA-Z_$][\w$]*/g) ?? [];
    for (const name of PRELUDE_NAMES) {
      expect(words).toContain(name);
    }
  });
});

describe("buildTurnMessages", () => {
  it("omits a prior document on the first turn", () => {
    const msgs = buildTurnMessages({ prompt: "a 60mm cube" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    // The controller confirmed the "REQUEST:" label stays and patched the plan,
    // so the exact first-turn content is pinned rather than a substring of it.
    expect(msgs[1].content).toBe("REQUEST:\na 60mm cube");
  });

  it("includes the prior document verbatim on later turns", () => {
    const msgs = buildTurnMessages({ prompt: "add a hole", priorDesign: design("Create a box") });
    const text = String(msgs[1].content);
    expect(text).toContain("return box(P.s, P.s, P.s);");
    expect(text).toContain("add a hole");
    expect(text).toContain("CURRENT DESIGN");
  });

  // The parameter VALUES live outside the script, so echoing the code alone
  // would silently reset every dimension the user had already tuned.
  it("echoes the prior parameter values, not just the code", () => {
    const msgs = buildTurnMessages({
      prompt: "make it taller",
      priorDesign: {
        code: "return box(P.w, P.d, P.h);",
        parameters: { w: { value: 40, unit: "mm" }, h: { value: 12.5, unit: "mm" } },
        summary: "Create a plate",
        turn: 2,
      },
    });
    const text = String(msgs[1].content);
    expect(text).toContain('"value": 12.5');
    expect(text).toContain('"w"');
    expect(text).toContain("make it taller");
  });

  it("carries the referenced-asset note when one is supplied", () => {
    const msgs = buildTurnMessages({ prompt: "match this", priorSourceNote: "asset 42" });
    expect(String(msgs[1].content)).toContain("asset 42");
  });

  it("attaches images as content blocks", () => {
    const msgs = buildTurnMessages({
      prompt: "make this", images: [{ data: "AAAA", mime: "image/png" }],
    });
    const blocks = msgs[1].content;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.some((b) => b.type === "image")).toBe(true);
  });
});

describe("buildRepairMessages", () => {
  const base = [{ role: "system", content: "s" }, { role: "user", content: "u" }];

  it("appends the failing code and the error as a new user turn", () => {
    const msgs = buildRepairMessages(base, design("Create a box"), "kernel status: NotManifold", [
      { gate: "kernel", ok: false, error: "kernel status: NotManifold" },
    ]);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("assistant");
    const text = String(msgs[3].content);
    expect(text).toContain("NotManifold");
    expect(text).toContain("kernel");
  });

  it("warns that the same script will fail the same way", () => {
    // CADPrompt 2026-10-10: told only "FIX THE SCRIPT", the model returned the
    // failing script byte for byte on 11 of 11 severed parts.
    const msgs = buildRepairMessages(base, design("Create a box"), "connected: 2 bodies", [
      { gate: "connected", ok: false, error: "connected: 2 bodies" },
    ]);
    expect(String(msgs[3].content)).toContain("fails the same way");
  });

  it("hands back the failing script so the model edits instead of re-deriving", () => {
    const previous = {
      code: "return hole(box(P.s, P.s, P.s), { diameter: 400 });",
      parameters: { s: { value: 20, unit: "mm" } },
      summary: "Create a box with a hole",
    };
    const msgs = buildRepairMessages(base, previous, "guard: rejected", []);
    expect(msgs[2].role).toBe("assistant");
    const echoed = String(msgs[2].content);
    expect(echoed).toContain("diameter: 400");
    expect(echoed).toContain('"s"');
  });

  // Task 7 measured an empty result failing BOTH the nonempty and the volume
  // gate: one cause, two lines. Rendering both asks the model to fix the same
  // thing twice, and the de-duplication belongs here rather than in the gates.
  it("collapses the empty-mesh cause reported by two gates into one line", () => {
    const msgs = buildRepairMessages(base, design("Create a box"), "kernel status: ok", [
      { gate: "guard", ok: true },
      { gate: "nonempty", ok: false, error: "mesh has no triangles - the operation removed the whole part" },
      { gate: "volume", ok: false, error: "solid has no volume - the result is degenerate" },
      { gate: "budget", ok: true },
    ]);
    const text = String(msgs[3].content);
    expect(text).toContain("- nonempty: mesh has no triangles");
    expect(text).not.toContain("- volume:");
  });

  it("keeps genuinely independent failures", () => {
    const msgs = buildRepairMessages(base, design("Create a box"), "static gates failed", [
      { gate: "guard", ok: false, error: "imports are not allowed" },
      { gate: "parameters", ok: false, error: "script must derive dimensions from PARAMETERS" },
      { gate: "nonempty", ok: true },
    ]);
    const text = String(msgs[3].content);
    expect(text).toContain("- guard: imports are not allowed");
    expect(text).toContain("- parameters: script must derive dimensions");
  });

  it("still says something when no gate detail is supplied", () => {
    const msgs = buildRepairMessages(base, design("Create a box"), "kernel host failed", []);
    const text = String(msgs[3].content);
    expect(text).toContain("kernel host failed");
    expect(text).toContain("(no detail)");
  });
});
