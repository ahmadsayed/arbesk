import { createRequest, createResponse } from "node-mocks-http";
import request from "supertest";
import express from "express";
import createRateLimitMiddleware, {
  generationRateLimit,
  _resetRateLimiters,
} from "../../src/api/rate-limiter.js";

async function run(mw, { userAddress, ip }) {
  const req = createRequest({ body: {}, ip });
  const res = createResponse({ locals: userAddress ? { userAddress } : {} });
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe("rate limiter keying", () => {
  beforeEach(() => _resetRateLimiters());

  it("keys on res.locals.userAddress even without txHash", async () => {
    const mw = createRateLimitMiddleware({ max: 2, windowMs: 60000 });
    expect((await run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" })).nextCalled).toBe(
      true,
    );
    expect((await run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" })).nextCalled).toBe(
      true,
    );
    const third = await run(mw, { userAddress: "0xWallet", ip: "3.3.3.3" });
    expect(third.nextCalled).toBe(false);
    expect(third.res.statusCode).toBe(429);
  });

  it("falls back to req.ip when no session address", async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 60000 });
    expect((await run(mw, { ip: "9.9.9.9" })).nextCalled).toBe(true);
    expect((await run(mw, { ip: "9.9.9.9" })).nextCalled).toBe(false);
  });

  it("gives each wallet an independent quota", async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 60000 });
    expect((await run(mw, { userAddress: "0xWalletA", ip: "1.1.1.1" })).nextCalled).toBe(
      true,
    );
    expect((await run(mw, { userAddress: "0xWalletB", ip: "1.1.1.1" })).nextCalled).toBe(
      true,
    );

    const blocked = await run(mw, { userAddress: "0xWalletA", ip: "1.1.1.1" });
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
  });

  it("does not let an IP-bucket consume a wallet's quota", async () => {
    const mw = createRateLimitMiddleware({ max: 1, windowMs: 60000 });
    // Consume the IP bucket for 1.1.1.1.
    expect((await run(mw, { ip: "1.1.1.1" })).nextCalled).toBe(true);
    expect((await run(mw, { ip: "1.1.1.1" })).nextCalled).toBe(false);

    // A wallet using the same IP must still be allowed because it keys on address.
    const wallet = await run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" });
    expect(wallet.nextCalled).toBe(true);
  });

  it("returns the configured message and retry-after metadata on rejection", async () => {
    const mw = createRateLimitMiddleware({
      max: 1,
      windowMs: 30000,
      message: "Custom rate limit message.",
    });
    expect((await run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" })).nextCalled).toBe(
      true,
    );

    const blocked = await run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" });
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
    const body = blocked.res._getJSONData();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBe("Custom rate limit message.");
    expect(body.error.details.retryAfterSeconds).toBe(30);
  });

  it("supports a dynamic max function", async () => {
    const mw = createRateLimitMiddleware({
      max: (_req, res) => (res.locals.userAddress ? 2 : 1),
      windowMs: 60000,
    });

    // Anonymous IP bucket: limit 1.
    expect((await run(mw, { ip: "2.2.2.2" })).nextCalled).toBe(true);
    expect((await run(mw, { ip: "2.2.2.2" })).nextCalled).toBe(false);

    // Wallet bucket: limit 2.
    expect((await run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" })).nextCalled).toBe(
      true,
    );
    expect((await run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" })).nextCalled).toBe(
      true,
    );
    expect((await run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" })).nextCalled).toBe(
      false,
    );
  });
});

describe("generationRateLimit BYOK bypass", () => {
  const WALLET = "0x1234567890123456789012345678901234567890";

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.locals = { userAddress: WALLET };
      next();
    });
    app.post("/generate", generationRateLimit, (req, res) =>
      res.status(200).json({ ok: true }),
    );
    return app;
  }

  beforeEach(() => {
    _resetRateLimiters();
    process.env.GENERATION_RATE_LIMIT_MAX = "2";
    delete process.env.MOCK_3D_GENERATION;
  });

  afterEach(() => {
    delete process.env.GENERATION_RATE_LIMIT_MAX;
  });

  test("mock requests count toward the generation limit", async () => {
    const app = buildApp();

    const first = await request(app).post("/generate").send({ provider: "mock" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/generate").send({ provider: "mock" });
    expect(second.status).toBe(200);

    const third = await request(app).post("/generate").send({ provider: "mock" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  test("BYOK tripo3d requests skip the generation limit", async () => {
    const app = buildApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post("/generate")
        .send({ provider: "tripo3d", providerKey: "user-key" });
      expect(res.status).toBe(200);
    }
  });

  test("tripo3d without providerKey still counts toward the limit", async () => {
    const app = buildApp();

    const first = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d" });
    expect(second.status).toBe(200);

    const third = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });

  test("whitespace-only providerKey does not bypass the limit", async () => {
    const app = buildApp();

    const first = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d", providerKey: "   " });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d", providerKey: "   " });
    expect(second.status).toBe(200);

    const third = await request(app)
      .post("/generate")
      .send({ provider: "tripo3d", providerKey: "   " });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
  });
});
