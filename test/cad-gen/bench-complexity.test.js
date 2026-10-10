import { describe, expect, it } from "bun:test";
import {
  COMPLEXITY_LEVELS, COMPLEXITY_QUESTION, askComplexity, complexityBand,
} from "../../scripts/lib/bench-complexity.mjs";

/** A Jev reply carrying the answers and usage the API documents. */
const reply = (/** @type {any} */ answers, /** @type {any} */ usage = { input_tokens: 12, output_tokens: 1 }) =>
  new Response(JSON.stringify({ answers, usage }));

describe("askComplexity", () => {
  it("posts the production state format and the 4-level rubric, and reads the score", async () => {
    /** @type {any} */
    let sent;
    const fetchImpl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
      sent = JSON.parse(init.body);
      return reply({ [COMPLEXITY_QUESTION]: { score: 2, confidence: 0.8 } });
    };
    const c = await askComplexity({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) },
      "Create a cube of 50 mm.");
    expect(sent.state).toBe("CAD part request: Create a cube of 50 mm.");
    expect(Object.keys(sent.questions)).toEqual([COMPLEXITY_QUESTION]);
    expect(sent.questions[COMPLEXITY_QUESTION]).toMatchObject({ type: "score", criteria: COMPLEXITY_LEVELS });
    expect(c).toEqual({ score: 2, confidence: 0.8, usage: { prompt: 12, completion: 1 } });
  });

  it("defaults a missing confidence to 0", async () => {
    const fetchImpl = async () => reply({ [COMPLEXITY_QUESTION]: { score: 1 } });
    expect(await askComplexity({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, "x"))
      .toMatchObject({ score: 1, confidence: 0 });
  });

  it("returns an error record for a non-OK response, without throwing", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    expect(await askComplexity({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, "x"))
      .toEqual({ error: expect.stringContaining("401") });
  });

  it("returns an error record for a reply with no numeric score", async () => {
    const fetchImpl = async () => reply({ [COMPLEXITY_QUESTION]: { confidence: 0.9 } });
    const c = await askComplexity({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, "x");
    expect(c).toEqual({ error: expect.stringContaining(COMPLEXITY_QUESTION) });
  });

  it("returns an error record when the request fails outright", async () => {
    const fetchImpl = async () => { throw new Error("socket hang up"); };
    expect(await askComplexity({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, "x"))
      .toEqual({ error: expect.stringContaining("socket hang up") });
  });
});

describe("complexityBand", () => {
  it("rounds to the nearest level and clamps into range", () => {
    expect(complexityBand(0)).toBe(COMPLEXITY_LEVELS[0]);
    expect(complexityBand(1.4)).toBe(COMPLEXITY_LEVELS[1]);
    expect(complexityBand(1.5)).toBe(COMPLEXITY_LEVELS[2]);
    expect(complexityBand(3)).toBe(COMPLEXITY_LEVELS[3]);
    expect(complexityBand(9)).toBe(COMPLEXITY_LEVELS[3]);
    expect(complexityBand(-2)).toBe(COMPLEXITY_LEVELS[0]);
  });
});
