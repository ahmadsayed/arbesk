import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const VALID_ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

async function loadModule(verifySiweResult, verifyThirdwebResult = null) {
  jest.resetModules();
  jest.unstable_mockModule("../../src/api/siwe-verify.js", () => ({
    verifySiwe: jest.fn(async () => verifySiweResult),
  }));
  jest.unstable_mockModule("../../src/api/thirdweb-auth.js", () => ({
    verifyThirdwebAuthToken: jest.fn(async () => verifyThirdwebResult),
  }));
  jest.unstable_mockModule("../../src/api/validation.js", () => ({
    validateBody: jest.fn(() => (req, res, next) => next()),
  }));
  return await import("../../src/api/sessions.js");
}

function createApp(routerFactory) {
  const app = express();
  app.use(express.json());
  app.use("/sessions", routerFactory());
  return app;
}

describe("session helpers", () => {
  let mod;

  beforeEach(async () => {
    mod = await loadModule({ valid: true, address: VALID_ADDRESS });
  });

  afterEach(() => {
    mod.sessions.clear();
    jest.useRealTimers();
  });

  it("createSession stores a lower-cased address and returns an opaque token", () => {
    const token = mod.createSession("0xAbCdEf0123456789012345678901234567890AbC");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(8);
    const session = mod.sessions.get(token);
    expect(session.address).toBe("0xabcdef0123456789012345678901234567890abc");
    expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("validateSession returns the address for a valid token", () => {
    const token = mod.createSession(VALID_ADDRESS);
    expect(mod.validateSession(token)).toBe(VALID_ADDRESS.toLowerCase());
  });

  it("validateSession returns null for a missing token", () => {
    expect(mod.validateSession("no-such-token")).toBeNull();
  });

  it("validateSession returns null and deletes an expired token", () => {
    const token = mod.createSession(VALID_ADDRESS);
    jest.useFakeTimers();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(mod.validateSession(token)).toBeNull();
    expect(mod.sessions.has(token)).toBe(false);
  });

  it("invalidateSession removes an existing token", () => {
    const token = mod.createSession(VALID_ADDRESS);
    mod.invalidateSession(token);
    expect(mod.sessions.has(token)).toBe(false);
  });

  it("invalidateSession is safe for a missing token", () => {
    expect(() => mod.invalidateSession("missing")).not.toThrow();
    expect(mod.sessions.has("missing")).toBe(false);
  });

  it("cleanup interval removes expired sessions", async () => {
    jest.useFakeTimers();
    mod = await loadModule({ valid: true, address: VALID_ADDRESS });
    const token = mod.createSession(VALID_ADDRESS);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(mod.sessions.has(token)).toBe(false);
  });
});

describe("session routes", () => {
  let mod;

  afterEach(() => {
    if (mod) mod.sessions.clear();
  });

  it("POST /sessions creates a session for a valid SIWE", async () => {
    mod = await loadModule({ valid: true, address: VALID_ADDRESS });
    const app = createApp(mod.default);
    const res = await request(app)
      .post("/sessions")
      .send({ message: "valid", signature: "0xabc" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    expect(mod.sessions.has(res.body.token)).toBe(true);
  });

  it("POST /sessions returns 400 for an invalid SIWE", async () => {
    mod = await loadModule({
      valid: false,
      address: null,
      error: "bad signature",
    });
    const app = createApp(mod.default);
    const res = await request(app)
      .post("/sessions")
      .send({ message: "valid", signature: "0xabc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SIWE");
    expect(res.body.error.message).toBe("bad signature");
  });

  it("POST /sessions returns 500 when verification throws", async () => {
    jest.resetModules();
    jest.unstable_mockModule("../../src/api/siwe-verify.js", () => ({
      verifySiwe: jest.fn(async () => {
        throw new Error("verify exploded");
      }),
    }));
    jest.unstable_mockModule("../../src/api/thirdweb-auth.js", () => ({
      verifyThirdwebAuthToken: jest.fn(async () => ({
        valid: false,
        error: "not used",
      })),
    }));
    jest.unstable_mockModule("../../src/api/validation.js", () => ({
      validateBody: jest.fn(() => (req, res, next) => next()),
    }));
    mod = await import("../../src/api/sessions.js");
    const app = createApp(mod.default);
    const res = await request(app)
      .post("/sessions")
      .send({ message: "valid", signature: "0xabc" });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("SESSION_CREATION_FAILED");
  });

  it("POST /sessions creates a session for a valid Thirdweb auth token", async () => {
    mod = await loadModule(
      { valid: true, address: VALID_ADDRESS },
      { valid: true, address: VALID_ADDRESS },
    );
    const app = createApp(mod.default);
    const res = await request(app)
      .post("/sessions")
      .send({ thirdwebAuthToken: "thirdweb-jwt" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    expect(mod.sessions.has(res.body.token)).toBe(true);
  });

  it("POST /sessions returns 400 for an invalid Thirdweb auth token", async () => {
    mod = await loadModule(
      { valid: true, address: VALID_ADDRESS },
      { valid: false, address: null, error: "bad jwt" },
    );
    const app = createApp(mod.default);
    const res = await request(app)
      .post("/sessions")
      .send({ thirdwebAuthToken: "thirdweb-jwt" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_THIRDWB_AUTH");
    expect(res.body.error.message).toBe("bad jwt");
  });

  it("DELETE /sessions invalidates the provided session", async () => {
    mod = await loadModule({ valid: true, address: VALID_ADDRESS });
    const token = mod.createSession(VALID_ADDRESS);
    const app = createApp(mod.default);

    const res = await request(app)
      .delete("/sessions")
      .set("Authorization", `Session ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.invalidated).toBe(true);
    expect(mod.sessions.has(token)).toBe(false);
  });

  it("DELETE /sessions returns 401 without a Session header", async () => {
    mod = await loadModule({ valid: true, address: VALID_ADDRESS });
    const app = createApp(mod.default);
    const res = await request(app).delete("/sessions");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_SESSION");
  });
});
