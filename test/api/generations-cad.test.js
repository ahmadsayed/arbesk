/**
 * Unified generations route with provider "cad": 202 → poll → design payload.
 * Mirrors test/api/cad-route.test.js's harness (injected generator, temp
 * quota state, real session store).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSession } from "../../src/api/sessions.ts";
import { _resetCadQuota } from "../../src/api/cad-quota.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";
import { _resetRegistry } from "../../src/api/generation-tasks.ts";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import { mountRoutes } from "../helpers/hono.js";

const { default: generateAssetNode } = await import("../../src/api/assets/generate-node.ts");

const WALLET = "0x1234567890123456789012345678901234567890";

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 1,
};

function generated(overrides = {}) {
  return {
    design: DESIGN,
    runtime: { contractVersion: 1, preludeVersion: "2026-09-16" },
    provider: { id: "deepseek", model: "deepseek-flash" },
    attribution: [],
    diagnostics: {
      selection: { libraries: [], fit: {}, jevTokens: {} },
      attempts: [],
      durationMs: 5,
      tokens: { prompt: 1, completion: 1 },
    },
    ...overrides,
  };
}

let statePath;
let generate;
let app;

function buildApp(deps = {}) {
  // core/storage are untouched by the cad path (no sourceResolver use) — stubs suffice.
  return mountRoutes("/generations", generateAssetNode({}, {}, { quotaStatePath: statePath, generator: { generate }, ...deps }));
}

function sessionHeader(address = WALLET) {
  return "Session " + createSession(address);
}

async function post(body, address = WALLET) {
  return request(app).post("/generations").set("Authorization", sessionHeader(address)).send(body);
}

async function until(predicate, what = "condition") {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(what + " never became true");
}

beforeEach(() => {
  _resetCadQuota();
  _resetRateLimiters();
  _resetRegistry();
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cad-gen-quota-")), "quota.json");
  generate = jest.fn(async () => generated());
  app = buildApp();
});

afterEach(() => {
  delete process.env.CAD_DAILY_REQUEST_LIMIT;
  delete process.env.CAD_GENERATION_ENABLED;
});

describe("POST /api/v1/generations with provider cad", () => {
  test("starts a task without a providerKey and returns a design payload on poll", async () => {
    const res = await post({ prompt: "a 10mm cube", nodeId: "n_cad_1", provider: "cad" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ provider: "cad", status: "running" });
    expect(typeof res.body.taskId).toBe("string");
    expect(res.headers["x-cad-quota-limit"]).toBeDefined();

    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("success");
    expect(poll.body.format).toBe("cad-design");
    expect(poll.body.design).toEqual(DESIGN);
    expect(poll.body.provider).toEqual({ id: "deepseek", model: "deepseek-flash" });
    expect(poll.body.assetData).toBeUndefined();
    expect(poll.body.diagnostics.attempts).toEqual([]);
  });

  test("reports running while the generator is in flight", async () => {
    let release;
    generate = jest.fn(async () => {
      await new Promise((resolve) => { release = resolve; });
      return generated();
    });
    app = buildApp();

    const res = await post({ prompt: "gated", nodeId: "n_cad_gate", provider: "cad" });
    expect(res.status).toBe(202);
    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.body.status).toBe("running");
    release();
    await until(async () => {
      const later = await request(app)
        .get("/generations/" + res.body.taskId)
        .set("Authorization", sessionHeader());
      return later.body.status === "success";
    }, "success poll");
  });

  test("rejects a missing prompt with 400", async () => {
    const res = await post({ nodeId: "n_cad_noprompt", provider: "cad" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("refuses a second in-flight cad request with 409", async () => {
    let release;
    generate = jest.fn(async () => {
      await new Promise((resolve) => { release = resolve; });
      return generated();
    });
    app = buildApp();

    const first = await post({ prompt: "one", nodeId: "n_cad_a", provider: "cad" });
    expect(first.status).toBe(202);
    const second = await post({ prompt: "two", nodeId: "n_cad_b", provider: "cad" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("GENERATION_IN_PROGRESS");
    expect(second.headers["retry-after"]).toBeDefined();
    release();
  });

  test("refuses with 429 once the daily quota is spent", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const first = await post({ prompt: "one", nodeId: "n_cad_q1", provider: "cad" });
    expect(first.status).toBe(202);
    const second = await post({ prompt: "two", nodeId: "n_cad_q2", provider: "cad" });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    expect(second.headers["x-cad-quota-remaining"]).toBe("0");
  });

  test("unsuitable subjects fail with CAD_REQUEST_UNSUITABLE and refund the unit", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    generate = jest.fn(async () => { throw new CadRequestUnsuitable("organic subject", 0.12); });
    app = buildApp();

    const res = await post({ prompt: "a dragon", nodeId: "n_cad_dragon", provider: "cad" });
    expect(res.status).toBe(202);
    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("failed");
    expect(poll.body.error.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(poll.body.error.suitability).toBe(0.12);
    expect(poll.body.error.alternative).toEqual({ kind: "organic-mesh", provider: "tripo3d" });

    // The refund means the spent unit is back: a follow-up request is admitted.
    generate = jest.fn(async () => generated());
    app = buildApp();
    const next = await post({ prompt: "a plate", nodeId: "n_cad_plate", provider: "cad" });
    expect(next.status).toBe(202);
  });

  test("answers 503 CAD_NOT_CONFIGURED when disabled", async () => {
    process.env.CAD_GENERATION_ENABLED = "false";
    const res = await post({ prompt: "x", nodeId: "n_cad_off", provider: "cad" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CAD_NOT_CONFIGURED");
  });

  test("an unknown provider stays 501", async () => {
    const res = await post({ prompt: "x", nodeId: "n_cad_foo", provider: "mystery" });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  test("DELETE cancels an in-flight cad task", async () => {
    let release;
    generate = jest.fn(async (input) => {
      await new Promise((resolve, reject) => {
        release = resolve;
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return generated();
    });
    app = buildApp();

    const res = await post({ prompt: "one", nodeId: "n_cad_del", provider: "cad" });
    const del = await request(app)
      .delete("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(del.status).toBe(200);
    expect(del.body.status).toBe("cancelled");
    expect(del.body.upstreamCancelled).toBe(true);
    release();
  });
});
