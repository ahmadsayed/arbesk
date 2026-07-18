/**
 * API route tests for POST /api/v1/paymaster.
 *
 * Covers: session auth gate, pm_* method allowlist, wallet-keyed rate limit,
 * unconfigured upstream, and the proxied success path.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

import { createSession } from "../../src/api/sessions.js";
import { _resetRateLimiters } from "../../src/api/rate-limiter.js";
import paymasterRoutes from "../../src/api/routes/paymaster.js";

const SESSION_WALLET = "0x1234567890123456789012345678901234567890";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/paymaster", paymasterRoutes());
  return app;
}

function sessionHeader(address = SESSION_WALLET) {
  return `Session ${createSession(address)}`;
}

const pmBody = { jsonrpc: "2.0", id: 1, method: "pm_sponsorUserOperation", params: [] };

let fetchSpy;

beforeEach(() => {
  _resetRateLimiters();
  delete process.env.CDP_PAYMASTER_URL;
  delete process.env.PAYMASTER_RATE_LIMIT_MAX;
  fetchSpy = jest.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

test("rejects requests without a session (401)", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  const res = await request(buildApp()).post("/paymaster").send(pmBody);

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe("MISSING_AUTH");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("rejects non-pm_* JSON-RPC methods (400)", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  const res = await request(buildApp())
    .post("/paymaster")
    .set("Authorization", sessionHeader())
    .send({ jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [] });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("PAYMASTER_METHOD_NOT_ALLOWED");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("returns 503 when CDP_PAYMASTER_URL is not configured", async () => {
  const res = await request(buildApp())
    .post("/paymaster")
    .set("Authorization", sessionHeader())
    .send(pmBody);

  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe("PAYMASTER_NOT_CONFIGURED");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("proxies pm_* calls upstream and returns the response verbatim", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  const upstreamPayload = { jsonrpc: "2.0", id: 1, result: { paymasterAndData: "0xabc" } };
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify(upstreamPayload), { status: 200 }),
  );

  const res = await request(buildApp())
    .post("/paymaster")
    .set("Authorization", sessionHeader())
    .send(pmBody);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(upstreamPayload);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0];
  expect(url).toBe("https://paymaster.example.com/rpc");
  expect(JSON.parse(init.body)).toEqual(pmBody);
});

test("rate-limits per wallet after PAYMASTER_RATE_LIMIT_MAX (429)", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  process.env.PAYMASTER_RATE_LIMIT_MAX = "2";
  fetchSpy.mockImplementation(() =>
    Promise.resolve(new Response("{}", { status: 200 })),
  );

  const app = buildApp();
  const auth = sessionHeader();
  const first = await request(app).post("/paymaster").set("Authorization", auth).send(pmBody);
  const second = await request(app).post("/paymaster").set("Authorization", auth).send(pmBody);
  const third = await request(app).post("/paymaster").set("Authorization", auth).send(pmBody);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(third.status).toBe(429);
  expect(third.body.error.code).toBe("RATE_LIMITED");
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("rate limit is per wallet, not global", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  process.env.PAYMASTER_RATE_LIMIT_MAX = "1";
  fetchSpy.mockImplementation(() =>
    Promise.resolve(new Response("{}", { status: 200 })),
  );

  const app = buildApp();
  const walletA = await request(app).post("/paymaster").set("Authorization", sessionHeader()).send(pmBody);
  const walletAAgain = await request(app).post("/paymaster").set("Authorization", sessionHeader()).send(pmBody);
  const walletB = await request(app)
    .post("/paymaster")
    .set("Authorization", sessionHeader("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"))
    .send(pmBody);

  expect(walletA.status).toBe(200);
  expect(walletAAgain.status).toBe(429);
  expect(walletB.status).toBe(200);
});

test("passes through upstream non-200 status and body unchanged", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  const upstreamPayload = { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad params" } };
  fetchSpy.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(upstreamPayload), { status: 400 })),
  );

  const res = await request(buildApp())
    .post("/paymaster")
    .set("Authorization", sessionHeader())
    .send(pmBody);

  expect(res.status).toBe(400);
  expect(res.body).toEqual(upstreamPayload);
});

test("returns 502 when the upstream fetch fails", async () => {
  process.env.CDP_PAYMASTER_URL = "https://paymaster.example.com/rpc";
  fetchSpy.mockRejectedValue(new Error("connect ECONNREFUSED"));

  const res = await request(buildApp())
    .post("/paymaster")
    .set("Authorization", sessionHeader())
    .send(pmBody);

  expect(res.status).toBe(502);
  expect(res.body.error.code).toBe("PAYMASTER_UPSTREAM_ERROR");
});
