/**
 * Tests for the generation advice judgement (src/api/generation-advice.ts) and
 * its route (POST /api/v1/generation-advice).
 *
 * Covers: the questions sent to Jev (CAD criterion only when the deployment
 * serves CAD), the answer reading (missing/unoffered answers), and the route's
 * admission and error table. Jev itself is faked at the fetch boundary.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import request from "supertest";
import { mountRoutes } from "../helpers/hono.js";
import { createSession } from "../../src/api/sessions.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";

const advice = await import("../../src/api/generation-advice.ts");
const { default: generationAdviceRoutes } = await import("../../src/api/routes/generation-advice.ts");

const WALLET = "0x1234567890123456789012345678901234567890";

/** A Jev reply body answering the provider and tripo config choices. */
function reply({ provider = "tripo3d", providerConfidence = 0.9, config = "balanced", configConfidence = 0.8 } = {}) {
  return {
    model: "jev-latest",
    answers: {
      [advice.PROVIDER_QUESTION]: {
        type: "choice", choice: provider, confidence: providerConfidence,
        probabilities: { [provider]: providerConfidence },
      },
      [advice.CONFIG_QUESTION]: {
        type: "choice", choice: config, confidence: configConfidence,
        probabilities: { [config]: configConfidence },
      },
    },
    usage: { input_tokens: 1000, output_tokens: 0 },
  };
}

function jevFetch(body, status = 200) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("adviceQuestions", () => {
  test("offers cad only when the deployment serves it", () => {
    const withCad = advice.adviceQuestions({ cadAvailable: true });
    expect(Object.keys(withCad[advice.PROVIDER_QUESTION].criteria)).toEqual(["cad", "tripo3d"]);

    const without = advice.adviceQuestions({ cadAvailable: false });
    expect(Object.keys(without[advice.PROVIDER_QUESTION].criteria)).toEqual(["tripo3d"]);
  });

  test("scores the tripo config against every curated bundle", () => {
    const q = advice.adviceQuestions({ cadAvailable: true });
    expect(Object.keys(q[advice.CONFIG_QUESTION].criteria)).toEqual(Object.keys(advice.GENERATION_CONFIGS));
    expect(q[advice.CONFIG_QUESTION].type).toBe("choice");
  });
});

describe("readGenerationAdvice", () => {
  test("passes provider and config through with their confidences", () => {
    const read = advice.readGenerationAdvice(reply({ provider: "cad", config: "game-ready" }), { cadAvailable: true });
    expect(read).toEqual({
      provider: "cad",
      providerConfidence: 0.9,
      providerProbabilities: { cad: 0.9 },
      config: "game-ready",
      configConfidence: 0.8,
      configProbabilities: { "game-ready": 0.8 },
    });
  });

  test("refuses a reply without the provider answer", () => {
    expect(() => advice.readGenerationAdvice({ answers: {} }, { cadAvailable: true })).toThrow(/provider/);
  });

  test("refuses a reply without the tripo config answer", () => {
    const body = reply();
    delete body.answers[advice.CONFIG_QUESTION];
    expect(() => advice.readGenerationAdvice(body, { cadAvailable: true })).toThrow(/config/);
  });

  test("refuses cad when it was not offered", () => {
    expect(() => advice.readGenerationAdvice(reply({ provider: "cad" }), { cadAvailable: false }))
      .toThrow(/not offered/);
  });

  test("refuses a config that was not offered", () => {
    expect(() => advice.readGenerationAdvice(reply({ config: "mega-ultra" }), { cadAvailable: true }))
      .toThrow(/not offered/);
  });
});

describe("POST /api/v1/generation-advice", () => {
  const saved = process.env.JEV_API_KEY;
  beforeEach(() => {
    process.env.JEV_API_KEY = "test-key";
    _resetRateLimiters();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.JEV_API_KEY;
    else process.env.JEV_API_KEY = saved;
  });

  const post = (app, body) =>
    request(app).post("/generation-advice").set("Authorization", "Session " + createSession(WALLET)).send(body);
  const appWith = (fetchImpl) => mountRoutes("/generation-advice", generationAdviceRoutes({ fetchImpl }));

  test("returns Jev's advice for the request", async () => {
    const fetchImpl = jevFetch(reply({ provider: "tripo3d", config: "hero-detail" }));
    const res = await post(appWith(fetchImpl), { prompt: "a statue bust for a museum scene", hasImage: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: "tripo3d",
      providerConfidence: 0.9,
      providerProbabilities: { tripo3d: 0.9 },
      config: "hero-detail",
      configConfidence: 0.8,
      configProbabilities: { "hero-detail": 0.8 },
    });

    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.state).toEqual({ request: "a statue bust for a museum scene", has_reference_image: true });
    expect(Object.keys(sent.questions[advice.PROVIDER_QUESTION].criteria)).toEqual(["tripo3d"]);
  });

  test("requires a session", async () => {
    const res = await request(appWith(jevFetch(reply()))).post("/generation-advice").send({ prompt: "x" });
    expect(res.status).toBe(401);
  });

  test("rejects an invalid body", async () => {
    const res = await post(appWith(jevFetch(reply())), { prompt: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("503 without a Jev key, so the client keeps its defaults", async () => {
    delete process.env.JEV_API_KEY;
    const fetchImpl = jevFetch(reply());
    const res = await post(appWith(fetchImpl), { prompt: "x" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GENERATION_ADVICE_UNAVAILABLE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("502 when Jev fails", async () => {
    const res = await post(appWith(jevFetch({ error: "boom" }, 500)), { prompt: "x" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("GENERATION_ADVICE_FAILED");
  });
});
