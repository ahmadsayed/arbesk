import { describe, expect, it } from "bun:test";
import { createJevClient, JevError } from "@arbesk/cad-gen/backend/jev.js";
import { FIT_THRESHOLD, selectLibraries } from "@arbesk/cad-gen/backend/select.js";
import { buildSystemPrompt } from "@arbesk/cad-gen/backend/prompt.js";
import { CATALOG_IDS } from "@arbesk/cad-gen/backend/catalog.js";
import { createCadGenerator } from "@arbesk/cad-gen/backend/facade.js";

/** A Jev transport answering each score question from a fixed table. */
function jevFetch(scores, seen = []) {
  return async (url, init) => {
    const req = JSON.parse(init.body);
    seen.push({ url, auth: init.headers.authorization, req });
    const answers = Object.fromEntries(Object.keys(req.questions).map((id) => [id, {
      type: "score", score: scores[id] ?? 0, confidence: 0.9,
    }]));
    return new Response(JSON.stringify({
      model: "jev-1.13.0", answers, usage: { input_tokens: 800, output_tokens: 100 },
    }), { status: 200 });
  };
}

/** A Jev client stub for the selector. */
const jevStub = (scores) => ({
  scoreFit: async () => ({
    fit: Object.fromEntries(CATALOG_IDS.map((id) => [id, { score: scores[id] ?? 0, confidence: 0.9 }])),
    usage: { prompt: 800, completion: 100 },
  }),
});

const prior = (code) => ({
  code, parameters: { s: { value: 10, unit: "mm" } }, summary: "the current part", turn: 1,
});

describe("createJevClient", () => {
  it("asks one score question per candidate, on the documented endpoint", async () => {
    const seen = [];
    const jev = createJevClient({ apiKey: "k", fetchImpl: jevFetch({ hinge: 1.9 }, seen) });
    const { fit, usage } = await jev.scoreFit("a hinged box", { hinge: "hinges", gear: "gears" });

    expect(seen[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen[0].auth).toBe("Bearer k");
    expect(seen[0].req.model).toBe("jev-latest");
    expect(seen[0].req.state).toContain("a hinged box");
    expect(Object.keys(seen[0].req.questions)).toEqual(["hinge", "gear"]);
    expect(seen[0].req.questions.hinge.type).toBe("score");
    expect(seen[0].req.questions.hinge.criteria).toHaveLength(3);
    expect(fit.hinge.score).toBe(1.9);
    expect(usage).toEqual({ prompt: 800, completion: 100 });
  });

  it("raises JevError on an HTTP failure", async () => {
    const jev = createJevClient({
      apiKey: "bad", fetchImpl: async () => new Response("no", { status: 401 }),
    });
    await expect(jev.scoreFit("x", { a: "a" })).rejects.toBeInstanceOf(JevError);
  });
});

describe("selectLibraries", () => {
  it("keeps the entries Jev scores at or above the threshold, in catalog order", async () => {
    const s = await selectLibraries(
      jevStub({ fasteners: 1.89, hinge: 1.99, household: FIT_THRESHOLD - 0.01 }),
      { prompt: "a hinged box with an M3 screw" },
    );
    expect(s.source).toBe("jev");
    expect(s.libraries).toEqual(["hinge", "fasteners"]);
    expect(Object.keys(s.fit)).toEqual(["hinge", "fasteners"]);
  });

  it("keeps every entry the current design already calls, even if Jev scores it low", async () => {
    const s = await selectLibraries(jevStub({}), {
      prompt: "make it taller", priorDesign: prior("return boardCase({ boardLength: P.s });"),
    });
    expect(s.libraries).toEqual(["board-case"]);
  });

  it("skips Jev on a client-reported repair and uses the design's own entries", async () => {
    let called = false;
    const s = await selectLibraries({ scoreFit: async () => { called = true; return {}; } }, {
      prompt: "x", priorDesign: prior("return spurGear({ module: P.s });"),
      failures: [{ gate: "kernel", error: "boom" }],
    });
    expect(called).toBe(false);
    expect(s).toMatchObject({ source: "prior", libraries: ["gear"] });
  });

  it("falls back to the whole catalog when Jev is not configured or fails", async () => {
    expect((await selectLibraries(undefined, { prompt: "x" })).libraries).toEqual(CATALOG_IDS);
    const failed = await selectLibraries(
      { scoreFit: async () => { throw new JevError("jev 529: overloaded", 529); } },
      { prompt: "x" },
    );
    expect(failed).toMatchObject({ source: "fallback", libraries: CATALOG_IDS });
    expect(failed.error).toContain("529");
  });
});

describe("the fit reaches the DeepSeek prompt", () => {
  it("states each selected module's fit above its guidance", () => {
    const prompt = buildSystemPrompt(["hinge"], { hinge: { score: 1.99, confidence: 0.98 } });
    expect(prompt).toContain("[module hinge: fit 1.99 of 2 - Clearly needed]");
    expect(prompt.indexOf("[module hinge")).toBeLessThan(prompt.indexOf("A hinge is ALWAYS"));
  });

  it("documents only the selected modules in the generation call", async () => {
    const sent = [];
    const g = createCadGenerator({
      apiKey: "k",
      jev: { apiKey: "j", fetchImpl: jevFetch({ hinge: 1.99 }) },
      fetchImpl: async (_u, init) => {
        sent.push(JSON.parse(init.body).messages[0].content);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            code: "return printInPlaceHinge({ length: P.s });",
            parameters: { s: { value: 30, unit: "mm" } }, summary: "a hinge",
          }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200 });
      },
    });
    const r = await g.generate({ prompt: "a print-in-place hinge" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("printInPlaceHinge(");
    expect(sent[0]).not.toContain("boardCase(");
    expect(r.diagnostics.selection).toMatchObject({ source: "jev", libraries: ["hinge"] });
    expect(r.diagnostics.selection.jevTokens).toEqual({ prompt: 800, completion: 100 });
    expect(r.diagnostics.tokens).toEqual({ prompt: 10, completion: 5 });
  }, 40000);
});
