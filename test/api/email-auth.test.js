/**
 * Email OTP auth route tests (P1).
 */
import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import emailAuthRoutes, { _resetOtpStoreForTesting } from "../../src/api/routes/email-auth.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";
import { validateSession, getSessionRecord } from "../../src/api/sessions.ts";
import { _resetCdpClientForTesting } from "../../src/api/cdp.ts";

const DEV_ADDR = "0x0000000000000000000000000000000000000abc";

function makeApp(fakeCdp, sendEmail) {
  const app = express();
  app.use(express.json());
  app.use("/auth/email", emailAuthRoutes({ getCdpClientFn: async () => fakeCdp, sendEmail }));
  return app;
}

function fakeCdp({ users = [], createdUserId = "user-1", smartAddress = DEV_ADDR } = {}) {
  return {
    endUser: {
      listEndUsers: jest.fn(async () => ({ endUsers: users, nextPageToken: undefined })),
      createEndUser: jest.fn(async () => ({ userId: createdUserId })),
      addEndUserEvmSmartAccount: jest.fn(async () => ({ evmSmartAccount: { address: smartAddress } })),
    },
  };
}

describe("email OTP auth (dev mode)", () => {
  const prevDev = process.env.CDP_EMAIL_DEV_MODE;
  const prevWs = process.env.CDP_WALLET_SECRET;

  beforeAll(() => {
    process.env.CDP_EMAIL_DEV_MODE = "true";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
  });
  afterAll(() => {
    if (prevDev === undefined) delete process.env.CDP_EMAIL_DEV_MODE;
    else process.env.CDP_EMAIL_DEV_MODE = prevDev;
    if (prevWs === undefined) delete process.env.CDP_WALLET_SECRET;
    else process.env.CDP_WALLET_SECRET = prevWs;
  });
  beforeEach(() => {
    _resetRateLimiters();
    _resetCdpClientForTesting();
  });

  test("request rejects an invalid email", async () => {
    const res = await request(makeApp(null)).post("/auth/email/request").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("request (dev mode) is a no-op success", async () => {
    const res = await request(makeApp(null)).post("/auth/email/request").send({ email: "maya@studio.com" });
    expect(res.status).toBe(200);
    expect(res.body.devMode).toBe(true);
  });

  test("verify rejects a malformed code", async () => {
    const res = await request(makeApp(null)).post("/auth/email/verify").send({ email: "maya@studio.com", code: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("verify rejects a wrong dev code", async () => {
    const res = await request(makeApp(null)).post("/auth/email/verify").send({ email: "maya@studio.com", code: "111111" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  test("verify (dev, no CDP) issues a session at a deterministic address", async () => {
    const app = makeApp(null);
    const a = await request(app).post("/auth/email/verify").send({ email: "maya@studio.com", code: "000000" });
    expect(a.status).toBe(201);
    expect(a.body.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.body.token).toBeTruthy();
    expect(validateSession(a.body.token)).toBe(a.body.address.toLowerCase());

    const b = await request(app).post("/auth/email/verify").send({ email: "maya@studio.com", code: "000000" });
    expect(b.body.address).toBe(a.body.address);
  });

  test("verify (dev, CDP existing user) binds to the existing smart account", async () => {
    const cdp = fakeCdp({
      users: [
        {
          userId: "u1",
          authenticationMethods: [{ type: "email", email: "maya@studio.com" }],
          evmSmartAccounts: [DEV_ADDR],
          evmSmartAccountObjects: [],
        },
      ],
    });
    const res = await request(makeApp(cdp)).post("/auth/email/verify").send({ email: "MAYA@studio.com", code: "000000" });
    expect(res.status).toBe(201);
    expect(res.body.address).toBe(DEV_ADDR);
    expect(cdp.endUser.createEndUser).not.toHaveBeenCalled();
    const record = getSessionRecord(res.body.token);
    expect(record.userId).toBe("u1");
    expect(record.email).toBe("maya@studio.com");
    expect(record.authMethod).toBe("email");
  });

  test("verify (dev, CDP new user) creates the end user + smart account", async () => {
    const cdp = fakeCdp({ users: [] });
    const res = await request(makeApp(cdp)).post("/auth/email/verify").send({ email: "maya@studio.com", code: "000000" });
    expect(res.status).toBe(201);
    expect(res.body.address).toBe(DEV_ADDR);
    expect(cdp.endUser.createEndUser).toHaveBeenCalled();
    expect(cdp.endUser.addEndUserEvmSmartAccount).toHaveBeenCalled();
  });

  test("verify (dev, CDP present but no wallet secret) returns a clear 503", async () => {
    const cdp = fakeCdp({ users: [] });
    delete process.env.CDP_WALLET_SECRET;
    try {
      const res = await request(makeApp(cdp)).post("/auth/email/verify").send({ email: "maya@studio.com", code: "000000" });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("CDP_WALLET_SECRET_NOT_CONFIGURED");
      expect(cdp.endUser.createEndUser).not.toHaveBeenCalled();
    } finally {
      process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    }
  });
});

describe("email OTP auth (real mode)", () => {
  const prevDev = process.env.CDP_EMAIL_DEV_MODE;

  beforeAll(() => {
    delete process.env.CDP_EMAIL_DEV_MODE;
  });
  afterAll(() => {
    if (prevDev === undefined) delete process.env.CDP_EMAIL_DEV_MODE;
    else process.env.CDP_EMAIL_DEV_MODE = prevDev;
  });
  beforeEach(() => {
    _resetRateLimiters();
    _resetCdpClientForTesting();
    _resetOtpStoreForTesting();
  });

  test("request returns 503 when no email provider is configured", async () => {
    const res = await request(makeApp(null)).post("/auth/email/request").send({ email: "maya@studio.com" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMAIL_OTP_NOT_CONFIGURED");
  });

  test("verify without a requested code returns OTP_EXPIRED", async () => {
    const res = await request(makeApp(null)).post("/auth/email/verify").send({ email: "maya@studio.com", code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });

  test("request + verify with a real code issues a session", async () => {
    const sent = [];
    const app = makeApp(null, async (email, code) => { sent.push({ email, code }); });
    const req = await request(app).post("/auth/email/request").send({ email: "maya@studio.com" });
    expect(req.status).toBe(200);
    expect(req.body.sent).toBe(true);
    expect(sent).toHaveLength(1);
    const code = sent[0].code;

    const res = await request(app).post("/auth/email/verify").send({ email: "maya@studio.com", code });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  test("verify rejects a wrong code (real mode)", async () => {
    const app = makeApp(null, async () => {});
    await request(app).post("/auth/email/request").send({ email: "maya@studio.com" });
    const res = await request(app).post("/auth/email/verify").send({ email: "maya@studio.com", code: "111111" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });
});
