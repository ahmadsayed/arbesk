import { createCadGenerator } from "@arbesk/cad-gen/backend/facade.js";

const body = (code, summary = "x") => JSON.stringify({
  code,
  parameters: { s: { value: 10, unit: "mm", min: 1, max: 100 } },
  summary,
});

const VALID = body("return box(P.s, P.s, P.s);", "Create a 10mm cube");
// Fails a STATIC gate, which is the only kind the server repairs now.
const BROKEN_GUARD = body("return mysteryHelper(P.s);", "broken");
// Geometrically broken but statically fine: the server must hand this back.
const BROKEN_KERNEL = body("return box(P.s, NaN, P.s);", "broken");
const BROKEN_PARSE = body("throw new Error('nope');", "broken");

// A fetch stub returning queued replies in order, repeating the last.
function stubFetch(replies) {
  let i = 0;
  return async () => {
    const content = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }), { status: 200 });
  };
}

const generator = (replies, limits = {}) => createCadGenerator({
  apiKey: "k",
  fetchImpl: stubFetch(replies),
  limits: { timeoutMs: 20000, maxTriangles: 200000, ...limits },
});

describe("createCadGenerator", () => {
  it("disables provider thinking by default and forwards an explicit choice", async () => {
    const seen = [];
    const capture = (config) => createCadGenerator({
      apiKey: "k",
      ...config,
      fetchImpl: async (_u, init) => {
        seen.push(JSON.parse(init.body).thinking);
        return new Response(JSON.stringify({
          choices: [{ message: { content: BROKEN_PARSE } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }), { status: 200 });
      },
    });

    // A design that cannot be parsed never reaches the kernel, so this stays
    // fast: every attempt fails at the document gate.
    await capture({}).generate({ prompt: "x", repairAttempts: 1 }).catch(() => {});
    await capture({ thinking: true }).generate({ prompt: "x", repairAttempts: 1 }).catch(() => {});

    expect(seen).toEqual([{ type: "disabled" }, { type: "enabled" }]);
  }, 40000);

  it("returns a design on the first attempt", async () => {
    const g = generator([VALID]);
    const r = await g.generate({ prompt: "a 10mm cube" });
    expect(r.design.parameters.s.value).toBe(10);
    expect(r.design.turn).toBe(1);
    expect(r.diagnostics.attempts).toHaveLength(1);
    expect(r.runtime.contractVersion).toBe(1);
    expect(typeof r.runtime.preludeVersion).toBe("string");
  }, 40000);

  // The server runs no kernel, so it must NOT claim the geometry is sound. A
  // field named "validation" that no longer validates would be a trap for
  // whoever reads the API next.
  it("makes no claim about geometry", async () => {
    const g = generator([VALID]);
    const r = await g.generate({ prompt: "a 10mm cube" });
    expect(r.validation).toBeUndefined();
    expect(r.diagnostics.attempts[0].gates.map((x) => x.gate)).not.toContain("kernel");
  }, 40000);

  // Pins the deliberate boundary: a design that is statically clean but
  // geometrically broken is handed BACK, not repaired. The client catches it and
  // drives the repair round, because only the host that builds the mesh can.
  it("hands back a design whose only failure is geometric", async () => {
    const g = generator([BROKEN_KERNEL]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.design.code).toContain("NaN");
    expect(r.diagnostics.attempts).toHaveLength(1);
    expect(r.diagnostics.attempts[0].ok).toBe(true);
  }, 40000);

  it("increments the turn from the prior document", async () => {
    const g = generator([VALID]);
    const r = await g.generate({
      prompt: "bigger",
      priorDesign: {
        code: "return box(P.s, P.s, P.s);",
        parameters: { s: { value: 10, unit: "mm" } },
        summary: "first",
        turn: 3,
      },
    });
    expect(r.design.turn).toBe(4);
  }, 40000);

  it("repairs a script that fails a static gate", async () => {
    const g = generator([BROKEN_GUARD, VALID]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.design.code).toContain("box(P.s");
    expect(r.diagnostics.attempts).toHaveLength(2);
    expect(r.diagnostics.attempts[0].ok).toBe(false);
    expect(r.diagnostics.attempts[1].ok).toBe(true);
  }, 60000);

  it("repairs a malformed document without a kernel run", async () => {
    const g = generator(["not json at all", VALID]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.diagnostics.attempts).toHaveLength(2);
    expect(r.diagnostics.attempts[0].gates[0].gate).toBe("document");
  }, 60000);

  it("throws CadGenerationFailed when every attempt fails", async () => {
    const g = generator([BROKEN_PARSE]);
    await expect(g.generate({ prompt: "x", repairAttempts: 2 })).rejects.toMatchObject({
      name: "CadGenerationFailed",
    });
  }, 60000);

  it("accumulates token usage across attempts", async () => {
    const g = generator([BROKEN_GUARD, VALID]);
    const r = await g.generate({ prompt: "x" });
    expect(r.diagnostics.tokens).toEqual({ prompt: 100, completion: 20 });
  }, 60000);

  it("caps repairAttempts at the configured maximum", async () => {
    const g = generator([BROKEN_PARSE], { maxRepairAttempts: 1 });
    const failed = g.generate({ prompt: "x", repairAttempts: 99 });
    await expect(failed).rejects.toMatchObject({ name: "CadGenerationFailed" });
    await expect(failed).rejects.toMatchObject({
      diagnostics: { attempts: [{ index: 0 }] },
    });
  }, 60000);
});
