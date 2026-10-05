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
import { Hono } from "hono";

import { createSession } from "../../src/api/sessions.ts";
import { _resetCadQuota } from "../../src/api/cad-quota.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";
import { _resetRegistry } from "../../src/api/generation-tasks.ts";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import { mountRoutes, toListener } from "../helpers/hono.js";

const { default: generateAssetNode } = await import("../../src/api/assets/generate-node.ts");
const { default: createApi } = await import("../../src/api/index.ts");

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

/**
 * The production composition shape: no injected generator, so only
 * CAD_MOCK_GENERATION (or a real DEEPSEEK_API_KEY) can satisfy the runtime.
 */
function buildBareApp() {
  return mountRoutes("/generations", generateAssetNode({}, {}, { quotaStatePath: statePath }));
}

/**
 * The real API app (src/api/index.ts) with stub deps, so the /config handler
 * can be exercised at its production path /api/v1/config.
 */
function buildConfigApp() {
  const api = createApi({
    storage: { backend: "kubo", gatewayBase: () => "http://127.0.0.1:8080/ipfs/" },
    core: {},
  });
  const wrapped = new Hono();
  wrapped.route("/api", api);
  return toListener(wrapped);
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
  delete process.env.CAD_MOCK_GENERATION;
  delete process.env.CAD_MOCK_UNSUITABLE;
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

  test("forwards priorDesign to the generator", async () => {
    const res = await post({
      prompt: "make it 2 mm taller", nodeId: "n_cad_edit", provider: "cad", priorDesign: DESIGN,
    });
    expect(res.status).toBe(202);
    await until(async () => generate.mock.calls.length > 0, "generate call");
    expect(generate.mock.calls[0][0]).toMatchObject({
      prompt: "make it 2 mm taller",
      priorDesign: { code: DESIGN.code, parameters: DESIGN.parameters, summary: "cube", turn: 1 },
    });
  });

  test("rejects a malformed priorDesign with 400 naming the field", async () => {
    const res = await post({
      prompt: "edit", nodeId: "n_cad_bad", provider: "cad", priorDesign: { code: "", parameters: {} },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues.some((i) => i.path[0] === "priorDesign")).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  test("rejects priorDesign on a non-cad provider", async () => {
    const res = await post({
      prompt: "edit", nodeId: "n_tripo_prior", provider: "tripo3d", providerKey: "k", priorDesign: DESIGN,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.some((i) => i.path[0] === "priorDesign")).toBe(true);
  });
});

describe("CAD_MOCK_GENERATION", () => {
  test("mock mode settles a canned design without DEEPSEEK_API_KEY", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevMock = process.env.CAD_MOCK_GENERATION;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      const res = await post({ provider: "cad", prompt: "a 40x30x20 box", nodeId: "node_1" });
      expect(res.status).toBe(202);
      expect(typeof res.body.taskId).toBe("string");

      let poll;
      await until(async () => {
        poll = await request(app)
          .get("/generations/" + res.body.taskId)
          .set("Authorization", sessionHeader());
        return poll.body.status === "success";
      }, "success poll");
      expect(poll.status).toBe(200);
      expect(poll.body.format).toBe("cad-design");
      expect(poll.body.design.code).toBe("return box(P.width, P.depth, P.height);");
      expect(poll.body.provider.id).toBe("mock");
      expect(poll.body.attribution).toEqual([]);
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
    }
  });

  test("mock mode edits: priorDesign comes back with turn + 1", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevMock = process.env.CAD_MOCK_GENERATION;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      app = buildBareApp();
      const prior = { ...DESIGN, turn: 2 };
      const res = await post({ prompt: "taller", nodeId: "n_cad_mock_edit", provider: "cad", priorDesign: prior });
      expect(res.status).toBe(202);
      let body;
      await until(async () => {
        body = (await request(app).get("/generations/" + res.body.taskId).set("Authorization", sessionHeader())).body;
        return body.status === "success";
      }, "mock edit success");
      expect(body.design.code).toBe(DESIGN.code);
      expect(body.design.turn).toBe(3);
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
    }
  });

  test("mock mode settles end-to-end with no injected generator and no DEEPSEEK_API_KEY", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevMock = process.env.CAD_MOCK_GENERATION;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      app = buildBareApp();
      const res = await post({ provider: "cad", prompt: "a 40x30x20 box", nodeId: "node_mock_bare" });
      expect(res.status).toBe(202);
      expect(typeof res.body.taskId).toBe("string");

      let poll;
      await until(async () => {
        poll = await request(app)
          .get("/generations/" + res.body.taskId)
          .set("Authorization", sessionHeader());
        return poll.body.status === "success";
      }, "success poll");
      expect(poll.status).toBe(200);
      expect(poll.body.format).toBe("cad-design");
      expect(poll.body.design.code).toBe("return box(P.width, P.depth, P.height);");
      expect(poll.body.provider.id).toBe("mock");
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
    }
  });

  test("CAD_MOCK_UNSUITABLE makes the mock generator refuse dragon prompts", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevMock = process.env.CAD_MOCK_GENERATION;
    const prevUnsuitable = process.env.CAD_MOCK_UNSUITABLE;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.CAD_MOCK_GENERATION = "true";
    process.env.CAD_MOCK_UNSUITABLE = "true";
    try {
      const { createMockCadGenerator } = await import("../../src/api/generation-providers.ts");
      const generator = createMockCadGenerator();

      let refusal;
      try {
        await generator.generate({ prompt: "a dragon" });
      } catch (err) {
        refusal = err;
      }
      expect(refusal).toBeDefined();
      expect(refusal.message).toBe("Request unsuitable for CAD generation");
      expect(refusal.suitability).toBe(0.1);
      expect(refusal.alternative).toEqual({ kind: "organic-mesh", provider: "tripo3d" });

      const ok = await generator.generate({ prompt: "a plate" });
      expect(ok.design.summary).toBe("Mock parametric box");
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
      if (prevUnsuitable === undefined) delete process.env.CAD_MOCK_UNSUITABLE; else process.env.CAD_MOCK_UNSUITABLE = prevUnsuitable;
    }
  });

  test("config endpoint reports cadGeneration", async () => {
    const prevMock = process.env.CAD_MOCK_GENERATION;
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      const res = await request(buildConfigApp()).get("/api/v1/config");
      expect(res.status).toBe(200);
      expect(res.body.cadGeneration).toBe(true);
    } finally {
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
    }
  });
});
