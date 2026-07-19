/**
 * API route tests for POST /api/v1/users/resolve-email.
 *
 * Covers: session auth gate, body validation, unconfigured CDP credentials,
 * exact-match semantics (no partial/autocomplete), minimal response shape,
 * pagination, SDK failure, and the per-wallet rate limit.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";

import { createSession } from "../../src/api/sessions.js";
import { _resetRateLimiters } from "../../src/api/rate-limiter.js";

const listEndUsers = jest.fn();

jest.unstable_mockModule("@coinbase/cdp-sdk", () => ({
  CdpClient: jest.fn(() => ({ endUser: { listEndUsers } })),
}));

const { default: usersRoutes } = await import("../../src/api/routes/users.js");

const SESSION_WALLET = "0x1234567890123456789012345678901234567890";
const SMART_ACCOUNT = "0x407EDfCFd16a5623012BbB778BD47A2bf861ed40";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/users", usersRoutes());
  return app;
}

function sessionHeader(address = SESSION_WALLET) {
  return `Session ${createSession(address)}`;
}

function endUser(email, smartAccounts = [SMART_ACCOUNT]) {
  return {
    userId: "user-1",
    authenticationMethods: [{ type: "email", email }],
    evmAccounts: ["0xccC626354A2Ea985d4aBDC1173597a46aFC63595"],
    evmSmartAccounts: smartAccounts,
  };
}

beforeEach(() => {
  _resetRateLimiters();
  process.env.CDP_API_KEY_ID = "test-key-id";
  process.env.CDP_API_KEY_SECRET = "test-key-secret";
  delete process.env.USER_RESOLVE_RATE_LIMIT_MAX;
  listEndUsers.mockReset();
});

afterEach(() => {
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
});

test("rejects requests without a session (401)", async () => {
  const res = await request(buildApp())
    .post("/users/resolve-email")
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe("MISSING_AUTH");
  expect(listEndUsers).not.toHaveBeenCalled();
});

test("rejects an invalid email body (400)", async () => {
  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "not-an-email" });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
  expect(listEndUsers).not.toHaveBeenCalled();
});

test("returns 503 when CDP server credentials are not configured", async () => {
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe("CDP_NOT_CONFIGURED");
  expect(listEndUsers).not.toHaveBeenCalled();
});

test("returns exists:false for an unknown email", async () => {
  listEndUsers.mockResolvedValue({
    endUsers: [endUser("bob@example.com")],
    nextPageToken: undefined,
  });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ exists: false });
});

test("returns exists:true with only the smart account address on exact match", async () => {
  listEndUsers.mockResolvedValue({
    endUsers: [endUser("alice@example.com")],
    nextPageToken: undefined,
  });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(200);
  // Minimal, need-to-know shape: no userId, no EOA, no email echo.
  expect(res.body).toEqual({ exists: true, address: SMART_ACCOUNT });
});

test("matching is case-insensitive and trims the input email", async () => {
  listEndUsers.mockResolvedValue({
    endUsers: [endUser("alice@example.com")],
    nextPageToken: undefined,
  });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "  Alice@Example.COM " });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ exists: true, address: SMART_ACCOUNT });
});

test("partial emails never match (no autocomplete)", async () => {
  listEndUsers.mockResolvedValue({
    endUsers: [endUser("alice@example.com")],
    nextPageToken: undefined,
  });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.co" });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ exists: false });
});

test("returns address:null when the user exists without a smart account", async () => {
  listEndUsers.mockResolvedValue({
    endUsers: [endUser("alice@example.com", [])],
    nextPageToken: undefined,
  });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ exists: true, address: null });
});

test("follows pagination to find a match on a later page", async () => {
  listEndUsers
    .mockResolvedValueOnce({
      endUsers: [endUser("bob@example.com")],
      nextPageToken: "page-2",
    })
    .mockResolvedValueOnce({
      endUsers: [endUser("alice@example.com")],
      nextPageToken: undefined,
    });

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ exists: true, address: SMART_ACCOUNT });
  expect(listEndUsers).toHaveBeenCalledTimes(2);
  expect(listEndUsers.mock.calls[1][0]).toEqual({
    pageSize: 100,
    pageToken: "page-2",
  });
});

test("returns 502 when the CDP SDK call fails", async () => {
  listEndUsers.mockRejectedValue(new Error("upstream 500"));

  const res = await request(buildApp())
    .post("/users/resolve-email")
    .set("Authorization", sessionHeader())
    .send({ email: "alice@example.com" });

  expect(res.status).toBe(502);
  expect(res.body.error.code).toBe("CDP_LOOKUP_FAILED");
});

test("rate-limits per wallet after USER_RESOLVE_RATE_LIMIT_MAX (429)", async () => {
  process.env.USER_RESOLVE_RATE_LIMIT_MAX = "2";
  listEndUsers.mockResolvedValue({ endUsers: [], nextPageToken: undefined });

  const app = buildApp();
  const auth = sessionHeader();
  const body = { email: "alice@example.com" };
  const first = await request(app).post("/users/resolve-email").set("Authorization", auth).send(body);
  const second = await request(app).post("/users/resolve-email").set("Authorization", auth).send(body);
  const third = await request(app).post("/users/resolve-email").set("Authorization", auth).send(body);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(third.status).toBe(429);
  expect(third.body.error.code).toBe("RATE_LIMITED");
  expect(listEndUsers).toHaveBeenCalledTimes(2);
});
