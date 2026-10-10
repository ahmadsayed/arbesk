/**
 * Tests for the follow-up intent judgement (src/api/followup-intent.ts) and its
 * route (POST /api/v1/followup-intent).
 *
 * Covers: the questions sent to Jev (restricted to the bubble's actions), the
 * answer reading (motion threshold, cap, travel), and the route's admission
 * and error table. Jev itself is faked at the fetch boundary.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import request from "supertest";
import { mountRoutes } from "../helpers/hono.js";
import { createSession } from "../../src/api/sessions.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";

const intent = await import("../../src/api/followup-intent.ts");
const { default: followupIntentRoutes } = await import("../../src/api/routes/followup-intent.ts");

const WALLET = "0x1234567890123456789012345678901234567890";
const ALL = ["retexture", "retopo", "auto-rig", "animate"];

/** A Jev reply body with the given action distribution and motion nouls. */
function reply({ choice = "animate", confidence = 0.95, motions = {}, travel = 0.1 } = {}) {
  const answers = {
    [intent.ACTION_QUESTION]: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } },
    [intent.TRAVEL_QUESTION]: { type: "noul", noul: travel },
  };
  for (const [id, noul] of Object.entries(motions)) {
    answers[intent.MOTION_PREFIX + id] = { type: "noul", noul };
  }
  return { model: "jev-latest", answers, usage: { input_tokens: 1100, output_tokens: 0 } };
}

function jevFetch(body, status = 200) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("followupQuestions", () => {
  test("offers only the bubble's actions, plus new_model and unclear", () => {
    const q = intent.followupQuestions(["animate"]);
    expect(Object.keys(q[intent.ACTION_QUESTION].criteria)).toEqual(["animate", "new_model", "unclear"]);
  });

  test("asks motion and travel questions only when animate is available", () => {
    const without = intent.followupQuestions(["retexture", "retopo"]);
    expect(Object.keys(without).some((k) => k.startsWith(intent.MOTION_PREFIX))).toBe(false);
    expect(without[intent.TRAVEL_QUESTION]).toBeUndefined();

    const withAnimate = intent.followupQuestions(ALL);
    const motionIds = Object.keys(withAnimate)
      .filter((k) => k.startsWith(intent.MOTION_PREFIX))
      .map((k) => k.slice(intent.MOTION_PREFIX.length));
    expect(motionIds).toEqual(Object.keys(intent.ANIMATION_MOTIONS));
    expect(withAnimate[intent.TRAVEL_QUESTION].type).toBe("noul");
  });
});

describe("readFollowupIntent", () => {
  test("keeps motions at or above the threshold, strongest first, at most five", () => {
    const motions = {
      "preset:walk": 0.98, "preset:run": 0.5, "preset:jump": 0.49,
      "preset:biped:dance_01": 0.9, "preset:biped:cheer": 0.8, "preset:biped:clap": 0.7, "preset:biped:bow": 0.6,
    };
    const read = intent.readFollowupIntent(reply({ motions }), ALL);
    expect(read.animations).toEqual([
      "preset:walk", "preset:biped:dance_01", "preset:biped:cheer", "preset:biped:clap", "preset:biped:bow",
    ]);
  });

  test("in place unless the request asks to travel", () => {
    expect(intent.readFollowupIntent(reply({ travel: 0.49 }), ALL).inPlace).toBe(true);
    expect(intent.readFollowupIntent(reply({ travel: 0.96 }), ALL).inPlace).toBe(false);
  });

  test("passes the action, confidence and distribution through", () => {
    const read = intent.readFollowupIntent(reply({ choice: "retopo", confidence: 0.88 }), ALL);
    expect(read).toMatchObject({ action: "retopo", confidence: 0.88, probabilities: { retopo: 0.88 } });
  });

  test("refuses a reply without the action answer", () => {
    expect(() => intent.readFollowupIntent({ answers: {} }, ALL)).toThrow(/action/);
  });

  test("refuses an action that was not offered", () => {
    expect(() => intent.readFollowupIntent(reply({ choice: "retopo" }), ["animate"])).toThrow(/not offered/);
  });
});

describe("POST /api/v1/followup-intent", () => {
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
    request(app).post("/followup-intent").set("Authorization", "Session " + createSession(WALLET)).send(body);
  const appWith = (fetchImpl) => mountRoutes("/followup-intent", followupIntentRoutes({ fetchImpl }));

  test("returns Jev's reading of the request", async () => {
    const fetchImpl = jevFetch(reply({ motions: { "preset:run": 0.97 }, travel: 0.96 }));
    const res = await post(appWith(fetchImpl), { prompt: "run across the room", modelName: "knight", actions: ALL });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: "animate", animations: ["preset:run"], inPlace: false });

    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.state).toEqual({ request: "run across the room", model: { name: "knight" } });
  });

  test("requires a session", async () => {
    const res = await request(appWith(jevFetch(reply()))).post("/followup-intent").send({ prompt: "x", actions: ALL });
    expect(res.status).toBe(401);
  });

  test("rejects unknown actions", async () => {
    const res = await post(appWith(jevFetch(reply())), { prompt: "x", actions: ["explode"] });
    expect(res.status).toBe(400);
  });

  test("503 without a Jev key, so the client keeps its default route", async () => {
    delete process.env.JEV_API_KEY;
    const fetchImpl = jevFetch(reply());
    const res = await post(appWith(fetchImpl), { prompt: "x", actions: ALL });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("FOLLOWUP_INTENT_UNAVAILABLE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("502 when Jev fails", async () => {
    const res = await post(appWith(jevFetch({ error: "boom" }, 500)), { prompt: "x", actions: ALL });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("FOLLOWUP_INTENT_FAILED");
  });
});
