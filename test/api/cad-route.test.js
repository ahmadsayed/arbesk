/**
 * API route tests for POST /api/v1/cad/generations and POST /api/v1/cad/repairs.
 *
 * Covers: the shared admission sequence (auth, schema, pre-checks, quota, lock,
 * hourly limiter), the quota headers, the error table, per-round metering, and
 * the attribution block the UI renders.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSession } from "../../src/api/sessions.ts";
import { _resetCadQuota } from "../../src/api/cad-quota.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";

const { default: cadRoutes } = await import("../../src/api/routes/cad.ts");

const WALLET = "0x1234567890123456789012345678901234567890";
const OTHER_WALLET = "0x9876543210987654321098765432109876543210";

const DESIGN = {
  code: "return box(P.w, P.d, P.h);",
  parameters: {
    w: { value: 60, unit: "mm" },
    d: { value: 40, unit: "mm" },
    h: { value: 10, unit: "mm" },
  },
  summary: "a plate",
  turn: 1,
};

const PHONE_STAND_CREDIT = {
  helper: "phoneStand",
  work: "SmartPhoneHolder",
  author: "DrLex",
  licence: "CC-BY",
  url: "https://github.com/DrLex0/print3d-customizable-smartphone-holder",
};

function generated(overrides = {}) {
  return {
    design: DESIGN,
    runtime: { contractVersion: 1, preludeVersion: "2026-09-16" },
    provider: { id: "deepseek", model: "deepseek-flash" },
    attribution: [],
    diagnostics: {
      attempts: [{ index: 0, ok: true, gates: [{ gate: "guard", ok: true }] }],
      durationMs: 1234,
      tokens: { prompt: 100, completion: 40 },
    },
    ...overrides,
  };
}

let statePath;
let generate;

function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/cad", cadRoutes({ quotaStatePath: statePath, generator: { generate }, ...overrides }));
  return app;
}

function sessionHeader(address = WALLET) {
  return "Session " + createSession(address);
}

/**
 * Fires one request.
 * @remarks Deliberately async. A supertest Test is a lazy thenable - the
 *   request is not dispatched until something awaits it - so a helper that
 *   merely RETURNED the Test would leave a "concurrent request" test with
 *   nothing in flight and no way to tell.
 */
async function post(route, body, address = WALLET, app = buildApp()) {
  return request(app).post(route).set("Authorization", sessionHeader(address)).send(body);
}

/** Waits for a condition, so a test never races the request it just started. */
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never became true");
}

/**
 * A generator that blocks until the test releases it.
 * @remarks Every caller gets its own resolver: a single one would be
 *   overwritten by the second concurrent request, and the first would then
 *   wait forever for a promise nobody can settle.
 */
function blockingGenerator() {
  const resolvers = [];
  return {
    fn: jest.fn(() => new Promise((resolve) => { resolvers.push(resolve); })),
    started: () => resolvers.length,
    releaseAll: (value) => resolvers.splice(0).forEach((resolve) => resolve(value)),
  };
}

beforeEach(() => {
  _resetCadQuota();
  _resetRateLimiters();
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cad-route-")), "quota.json");
  generate = jest.fn(async () => generated());
  process.env.CAD_DAILY_REQUEST_LIMIT = "50";
  process.env.DEEPSEEK_API_KEY = "test-key";
  delete process.env.CAD_GENERATION_ENABLED;
  delete process.env.CAD_MAX_REPAIR_ATTEMPTS;
  delete process.env.CAD_MAX_IMAGE_BYTES;
  delete process.env.CAD_MAX_REQUEST_MS;
});

afterEach(() => {
  for (const key of [
    "CAD_DAILY_REQUEST_LIMIT", "DEEPSEEK_API_KEY", "CAD_GENERATION_ENABLED",
    "CAD_MAX_REPAIR_ATTEMPTS", "CAD_MAX_IMAGE_BYTES", "CAD_MAX_REQUEST_MS",
  ]) delete process.env[key];
  fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
});

describe("POST /cad/generations", () => {
  test("rejects a request with no session (401)", async () => {
    const res = await request(buildApp()).post("/cad/generations").send({ prompt: "a box" });
    expect(res.status).toBe(401);
  });

  test("returns the design, runtime, provider and attribution", async () => {
    generate = jest.fn(async () => generated({ attribution: [PHONE_STAND_CREDIT] }));
    const res = await post("/cad/generations", { prompt: "a phone stand" });

    expect(res.status).toBe(200);
    expect(res.body.design.code).toBe(DESIGN.code);
    expect(res.body.runtime.contractVersion).toBe(1);
    expect(res.body.provider).toEqual({ id: "deepseek", model: "deepseek-flash" });
    expect(res.body.diagnostics.attempts).toHaveLength(1);
  });

  test("returns the licence and attribution the UI shows", async () => {
    generate = jest.fn(async () => generated({ attribution: [PHONE_STAND_CREDIT] }));
    const res = await post("/cad/generations", { prompt: "a phone stand" });

    expect(res.body.attribution).toEqual([PHONE_STAND_CREDIT]);
    expect(res.body.attribution[0].licence).toBe("CC-BY");
    expect(res.body.attribution[0].author).toBe("DrLex");
  });

  test("returns an empty attribution array when nothing licensed was used", async () => {
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.body.attribution).toEqual([]);
  });

  test("has no validation field - the server ran no kernel", async () => {
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.body).not.toHaveProperty("validation");
  });

  test("passes the prompt, images and priorDesign through to the generator", async () => {
    const body = {
      prompt: "add a fillet",
      priorDesign: DESIGN,
      images: [{ data: "aGVsbG8=", mime: "image/png" }],
      repairAttempts: 1,
    };
    await post("/cad/generations", body);

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "add a fillet",
      priorDesign: DESIGN,
      images: [{ data: "aGVsbG8=", mime: "image/png" }],
      repairAttempts: 1,
    }));
  });

  test("rejects an invalid body with 400 and field issues", async () => {
    const res = await post("/cad/generations", { prompt: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
  });

  test("rejects a repairAttempts above the documented cap", async () => {
    const res = await post("/cad/generations", { prompt: "a box", repairAttempts: 9 });
    expect(res.status).toBe(400);
  });

  test("rejects a non-mm parameter unit in the echoed design", async () => {
    const res = await post("/cad/generations", {
      prompt: "a box",
      priorDesign: { ...DESIGN, parameters: { w: { value: 60, unit: "inch" } } },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /cad/generations - admission", () => {
  test("sets the quota headers", async () => {
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.headers["x-cad-quota-limit"]).toBe("50");
    expect(res.headers["x-cad-quota-remaining"]).toBe("49");
    expect(Number(res.headers["x-cad-quota-reset"])).toBeGreaterThan(0);
  });

  test("refuses a second concurrent request for the same wallet (409)", async () => {
    const gate = blockingGenerator();
    generate = gate.fn;
    const app = buildApp();

    const first = post("/cad/generations", { prompt: "a box" }, WALLET, app);
    await until(() => gate.started() === 1);
    const second = await post("/cad/generations", { prompt: "a box" }, WALLET, app);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("GENERATION_IN_PROGRESS");
    expect(second.body.error.details.startedAt).toBeGreaterThan(0);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    // The lock is per wallet, and the refused request never reached the provider.
    expect(gate.started()).toBe(1);

    gate.releaseAll(generated());
    expect((await first).status).toBe(200);
  });

  test("lets a different wallet through while one is in flight", async () => {
    const gate = blockingGenerator();
    generate = gate.fn;
    const app = buildApp();

    const first = post("/cad/generations", { prompt: "a box" }, WALLET, app);
    await until(() => gate.started() === 1);
    const second = post("/cad/generations", { prompt: "a box" }, OTHER_WALLET, app);
    await until(() => gate.started() === 2);
    gate.releaseAll(generated());

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  test("returns 429 with the quota headers once the day is spent", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const app = buildApp();
    expect((await post("/cad/generations", { prompt: "a box" }, WALLET, app)).status).toBe(200);

    const res = await post("/cad/generations", { prompt: "again" }, WALLET, app);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    expect(res.body.error.details).toEqual({ limit: 1, used: 1, resetsAt: expect.any(Number) });
    expect(res.headers["x-cad-quota-remaining"]).toBe("0");
  });

  test("a quota rejection does not spend a provider call", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const app = buildApp();
    expect((await post("/cad/generations", { prompt: "a box" }, WALLET, app)).status).toBe(200);
    generate.mockClear();

    const res = await post("/cad/generations", { prompt: "again" }, WALLET, app);
    expect(res.status).toBe(429);
    expect(generate).not.toHaveBeenCalled();
  });

  test("a rejected request frees the slot for the next one", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const app = buildApp();
    await post("/cad/generations", { prompt: "a box" }, WALLET, app);
    // Quota, not the lock, is what refuses this one.
    const denied = await post("/cad/generations", { prompt: "again" }, WALLET, app);
    expect(denied.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    // A different wallet still works, proving the lock table is per wallet.
    expect((await post("/cad/generations", { prompt: "x" }, OTHER_WALLET, app)).status).toBe(200);
  });
});

describe("POST /cad/generations - configuration", () => {
  test("503 when DEEPSEEK_API_KEY is unset and no generator is injected", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const app = express();
    app.use(express.json());
    app.use("/cad", cadRoutes({ quotaStatePath: statePath }));
    const res = await request(app)
      .post("/cad/generations").set("Authorization", sessionHeader()).send({ prompt: "a box" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CAD_NOT_CONFIGURED");
    expect(res.body.error.message).toContain("DEEPSEEK_API_KEY");
  });

  test("503 when CAD_GENERATION_ENABLED=false", async () => {
    process.env.CAD_GENERATION_ENABLED = "false";
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
  });

  test("an unusable CAD_DAILY_REQUEST_LIMIT is a 503 naming the variable, not a 429", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "lots";
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain("CAD_DAILY_REQUEST_LIMIT");
    expect(res.body.error.message).toContain("lots");
  });

  test("a zero CAD_DAILY_REQUEST_LIMIT is refused as configuration, not as quota", async () => {
    // Zero is not a limit, it is an ambiguous request to turn the feature off.
    // CAD_GENERATION_ENABLED is how that is said, so this names the variable at
    // fault instead of telling the operator they are out of quota they never had.
    process.env.CAD_DAILY_REQUEST_LIMIT = "0";
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain("CAD_DAILY_REQUEST_LIMIT");
  });

  test("an unusable CAD_MAX_REPAIR_ATTEMPTS is a 503 too", async () => {
    process.env.CAD_MAX_REPAIR_ATTEMPTS = "-1";
    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain("CAD_MAX_REPAIR_ATTEMPTS");
  });
});

describe("POST /cad/generations - pre-checks run before the wallet is charged", () => {
  test("413 for an image past CAD_MAX_IMAGE_BYTES, with no round spent", async () => {
    process.env.CAD_MAX_IMAGE_BYTES = "8";
    const res = await post("/cad/generations", {
      prompt: "a box",
      images: [{ data: Buffer.alloc(64).toString("base64"), mime: "image/png" }],
    });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("IMAGE_TOO_LARGE");
    expect(generate).not.toHaveBeenCalled();
  });

  test("501 when sourceRef is sent, because resolution is not wired yet", async () => {
    const res = await post("/cad/generations", {
      prompt: "make it bigger",
      sourceRef: { cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" },
    });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("SOURCE_ASSET_RESOLUTION_UNAVAILABLE");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("POST /cad/repairs", () => {
  test("requires priorDesign - a repair with nothing to repair is a generation", async () => {
    const res = await post("/cad/repairs", {
      prompt: "still broken",
      failures: [{ gate: "kernel", error: "empty after subtract" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("requires at least one reported failure", async () => {
    const res = await post("/cad/repairs", { prompt: "still broken", priorDesign: DESIGN, failures: [] });
    expect(res.status).toBe(400);
  });

  test("forwards the prior design and the reported failures", async () => {
    const failures = [{ gate: "kernel", error: "part is empty after subtract" }];
    const res = await post("/cad/repairs", {
      prompt: "add three holes", priorDesign: DESIGN, failures,
    });

    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "add three holes",
      priorDesign: DESIGN,
      failures,
    }));
  });

  test("meters one round per repair, decrementing the header each time", async () => {
    const app = buildApp();
    const body = { prompt: "fix it", priorDesign: DESIGN, failures: [{ gate: "kernel", error: "empty" }] };

    const first = await post("/cad/repairs", body, WALLET, app);
    const second = await post("/cad/repairs", body, WALLET, app);
    const third = await post("/cad/repairs", body, WALLET, app);

    expect([first.headers["x-cad-quota-remaining"], second.headers["x-cad-quota-remaining"],
      third.headers["x-cad-quota-remaining"]]).toEqual(["49", "48", "47"]);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  test("the round budget is the loop bound: a fabricated failure still costs quota", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const app = buildApp();
    const body = { prompt: "fix it", priorDesign: DESIGN, failures: [{ gate: "kernel", error: "empty" }] };

    expect((await post("/cad/repairs", body, WALLET, app)).status).toBe(200);
    const second = await post("/cad/repairs", body, WALLET, app);
    expect(second.status).toBe(429);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("the real generator, with only the transport stubbed", () => {
  /** A DeepSeek chat-completion response carrying one design document. */
  function completion(design) {
    return {
      choices: [{ message: { content: JSON.stringify(design) } }],
      usage: { prompt_tokens: 4734, completion_tokens: 167 },
    };
  }

  function appWithTransport(fetchImpl) {
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use("/cad", cadRoutes({ quotaStatePath: statePath, fetchImpl }));
    return app;
  }

  test("a design calling a ported helper comes back with its licence credit", async () => {
    // The whole server path - prompt assembly, the provider call, the static
    // gates - with nothing stubbed but the socket. This is what proves the
    // credit is computed by the real facade rather than only by a test double.
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(completion({
      code: "return phoneStand(P.t, P.lift, P.w);",
      parameters: {
        t: { value: 12, unit: "mm" },
        lift: { value: 60, unit: "mm" },
        w: { value: 80, unit: "mm" },
      },
      summary: "a phone stand",
    })), { status: 200, headers: { "content-type": "application/json" } }));

    const res = await request(appWithTransport(fetchImpl))
      .post("/cad/generations").set("Authorization", sessionHeader())
      .send({ prompt: "a desk phone stand" });

    expect(res.status).toBe(200);
    expect(res.body.attribution).toEqual([PHONE_STAND_CREDIT]);
    expect(res.body.provider).toEqual({ id: "deepseek", model: "deepseek-flash" });
    expect(res.body.design.parameters.t.value).toBe(12);
    expect(res.body.diagnostics.attempts[0].ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a design calling no ported helper is credited to nobody", async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(completion({
      code: "return box(P.w, P.d, P.h);",
      parameters: {
        w: { value: 60, unit: "mm" },
        d: { value: 40, unit: "mm" },
        h: { value: 10, unit: "mm" },
      },
      summary: "a plate",
    })), { status: 200, headers: { "content-type": "application/json" } }));

    const res = await request(appWithTransport(fetchImpl))
      .post("/cad/generations").set("Authorization", sessionHeader())
      .send({ prompt: "a 60x40x10 plate" });

    expect(res.status).toBe(200);
    expect(res.body.attribution).toEqual([]);
  });

  test("a script the static guard rejects is repaired, not returned", async () => {
    // The provider's first answer is unusable, so the server must spend a second
    // round rather than hand the client a script it already knows is bad.
    const bad = { code: "const b = box(1,1,1);", parameters: { s: { value: 1, unit: "mm" } }, summary: "no return" };
    const good = {
      code: "return box(P.w, P.d, P.h);",
      parameters: { w: { value: 60, unit: "mm" }, d: { value: 40, unit: "mm" }, h: { value: 10, unit: "mm" } },
      summary: "a plate",
    };
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call++;
      return new Response(JSON.stringify(completion(call === 1 ? bad : good)),
        { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await request(appWithTransport(fetchImpl))
      .post("/cad/generations").set("Authorization", sessionHeader())
      .send({ prompt: "a plate" });

    expect(res.status).toBe(200);
    expect(res.body.design.code).toBe(good.code);
    expect(res.body.diagnostics.attempts).toHaveLength(2);
    expect(res.body.diagnostics.attempts[0].ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("the repair endpoint feeds the client's failures into the repair turn", async () => {
    let sent;
    const fetchImpl = jest.fn(async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify(completion({
        code: "return box(P.w, P.d, P.h).subtract(hole(box(P.w, P.d, P.h), { diameter: 6, axis: 'z' }));",
        parameters: { w: { value: 60, unit: "mm" }, d: { value: 40, unit: "mm" }, h: { value: 10, unit: "mm" } },
        summary: "a plate with a hole",
      })), { status: 200, headers: { "content-type": "application/json" } });
    });

    const res = await request(appWithTransport(fetchImpl))
      .post("/cad/repairs").set("Authorization", sessionHeader())
      .send({
        prompt: "add a 6mm hole",
        priorDesign: DESIGN,
        failures: [{ gate: "nonempty", error: "part is empty after subtract" }],
      });

    expect(res.status).toBe(200);
    const conversation = JSON.stringify(sent.messages);
    expect(conversation).toContain("part is empty after subtract");
    expect(conversation).toContain("nonempty");
    // The client's own account of the geometry is a hint, not a verdict: the
    // server still re-ran the guard on what came back.
    expect(res.body.diagnostics.attempts[0].gates.some((g) => g.gate === "guard")).toBe(true);
  });
});

describe("provider and generation failures", () => {
  test("a CadGenerationFailed is a 500 carrying diagnostics", async () => {
    const diagnostics = { attempts: [{ index: 0, ok: false, gates: [] }], tokens: { prompt: 1, completion: 1 } };
    const err = new Error("CAD generation failed after 3 attempts");
    err.name = "CadGenerationFailed";
    err.diagnostics = diagnostics;
    generate = jest.fn(async () => { throw err; });

    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("CAD_GENERATION_FAILED");
    expect(res.body.error.details).toEqual(diagnostics);
  });

  test("a provider auth failure is a 502, never a 401 that blames the session", async () => {
    const err = new Error("deepseek 401");
    err.name = "ProviderError";
    err.code = "PROVIDER_AUTH_FAILED";
    err.status = 401;
    generate = jest.fn(async () => { throw err; });

    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_AUTH_FAILED");
  });

  test("a transport failure is a 502 PROVIDER_ERROR", async () => {
    const err = new Error("timeout after 120000ms");
    err.name = "ProviderError";
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    generate = jest.fn(async () => { throw err; });

    const res = await post("/cad/generations", { prompt: "a box" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_ERROR");
  });

  test("a thrown generator still frees the slot", async () => {
    generate = jest.fn(async () => { throw new Error("boom"); });
    const app = buildApp();
    expect((await post("/cad/generations", { prompt: "a box" }, WALLET, app)).status).toBe(500);

    generate = jest.fn(async () => generated());
    const app2 = buildApp();
    expect((await post("/cad/generations", { prompt: "a box" }, WALLET, app2)).status).toBe(200);
  });
});

describe("the hourly limiter", () => {
  test("429 RATE_LIMITED once a wallet bursts past CAD_RATE_LIMIT_MAX", async () => {
    process.env.CAD_RATE_LIMIT_MAX = "2";
    _resetRateLimiters();
    const app = buildApp();

    expect((await post("/cad/generations", { prompt: "a" }, WALLET, app)).status).toBe(200);
    expect((await post("/cad/generations", { prompt: "b" }, WALLET, app)).status).toBe(200);
    const third = await post("/cad/generations", { prompt: "c" }, WALLET, app);

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    delete process.env.CAD_RATE_LIMIT_MAX;
  });

  test("a limiter rejection frees the in-flight slot", async () => {
    process.env.CAD_RATE_LIMIT_MAX = "1";
    _resetRateLimiters();
    const app = buildApp();

    await post("/cad/generations", { prompt: "a" }, WALLET, app);
    const limited = await post("/cad/generations", { prompt: "b" }, WALLET, app);
    expect(limited.body.error.code).toBe("RATE_LIMITED");

    // The limiter refused after the lock was taken; a different wallet proves
    // nothing is wedged, and the same wallet recovers on the next window.
    _resetRateLimiters();
    expect((await post("/cad/generations", { prompt: "c" }, WALLET, app)).status).toBe(200);
    delete process.env.CAD_RATE_LIMIT_MAX;
  });
});
