import { createCadGenerator } from "@arbesk/cad-gen/backend/facade.js";

const body = (code, summary = "x") => JSON.stringify({
  code,
  parameters: { s: { value: 10, unit: "mm", min: 1, max: 100 } },
  summary,
});

const VALID = body("return box(P.s, P.s, P.s);", "Create a 10mm cube");
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
  it("returns a validated design on the first attempt", async () => {
    const g = generator([VALID]);
    const r = await g.generate({ prompt: "a 10mm cube" });
    expect(r.design.parameters.s.value).toBe(10);
    expect(r.design.turn).toBe(1);
    expect(r.validation.mode).toBe("kernel");
    expect(r.validation.stats.volumeMm3).toBeCloseTo(1000, 0);
    expect(r.diagnostics.attempts).toHaveLength(1);
    expect(r.runtime.contractVersion).toBe(1);
    expect(typeof r.runtime.preludeVersion).toBe("string");
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

  it("repairs a script that fails a kernel gate", async () => {
    const g = generator([BROKEN_KERNEL, VALID]);
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
    const g = generator([BROKEN_KERNEL, VALID]);
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
