import { Hono } from "hono";
import createRateLimitMiddleware, {
  generationRateLimit,
  _resetRateLimiters,
} from "../../src/hono/rate-limit.ts";

function buildApp(mw, { walletHeader = false } = {}) {
  const app = new Hono();
  if (walletHeader) {
    app.use(async (c, next) => {
      const wallet = c.req.header("x-test-wallet");
      if (wallet) c.set("userAddress", wallet);
      await next();
    });
  }
  app.all("/limited", mw, (c) => c.json({ ok: true }));
  return app;
}

const get = (app, wallet) =>
  app.request("http://localhost/limited", {
    headers: wallet ? { "x-test-wallet": wallet } : {},
  });

describe("hono rate limiter", () => {
  beforeEach(() => _resetRateLimiters());

  it("keys on userAddress and allows up to max", async () => {
    const app = buildApp(createRateLimitMiddleware({ max: 2 }), {
      walletHeader: true,
    });

    expect((await get(app, "0xWallet")).status).toBe(200);
    expect((await get(app, "0xWallet")).status).toBe(200);
    const third = await get(app, "0xWallet");
    expect(third.status).toBe(429);
    const body = await third.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("falls back to the client IP bucket without a session address", async () => {
    const app = buildApp(createRateLimitMiddleware({ max: 1 }));
    // In-process requests share one client identity (no socket).
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
  });

  it("gives each wallet an independent quota", async () => {
    const app = buildApp(createRateLimitMiddleware({ max: 1 }), {
      walletHeader: true,
    });

    expect((await get(app, "0xWalletA")).status).toBe(200);
    expect((await get(app, "0xWalletB")).status).toBe(200);
    expect((await get(app, "0xWalletA")).status).toBe(429);
  });

  it("does not let the IP bucket consume a wallet's quota", async () => {
    const app = buildApp(createRateLimitMiddleware({ max: 1 }), {
      walletHeader: true,
    });

    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
    expect((await get(app, "0xWallet")).status).toBe(200);
  });

  it("returns the configured message, retry metadata, and RateLimit-* headers", async () => {
    const app = buildApp(
      createRateLimitMiddleware({
        max: 1,
        windowMs: 30000,
        message: "Custom rate limit message.",
      }),
    );

    const first = await get(app);
    expect(first.status).toBe(200);
    expect(first.headers.get("RateLimit-Limit")).toBe("1");
    expect(first.headers.get("RateLimit-Remaining")).toBe("0");
    expect(first.headers.get("RateLimit-Policy")).toBe("1;w=30");
    expect(Number(first.headers.get("RateLimit-Reset"))).toBeGreaterThan(0);

    const blocked = await get(app);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(
      blocked.headers.get("RateLimit-Reset"),
    );
    const body = await blocked.json();
    expect(body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Custom rate limit message.",
        details: { retryAfterSeconds: 30 },
      },
    });
  });

  it("supports a dynamic max function", async () => {
    const app = buildApp(
      createRateLimitMiddleware({
        max: (c) => (c.get("userAddress") ? 2 : 1),
      }),
      { walletHeader: true },
    );

    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);

    expect((await get(app, "0xWallet")).status).toBe(200);
    expect((await get(app, "0xWallet")).status).toBe(200);
    expect((await get(app, "0xWallet")).status).toBe(429);
  });
});

describe("hono generationRateLimit BYOK bypass", () => {
  const WALLET = "0x1234567890123456789012345678901234567890";

  function buildApp() {
    const app = new Hono();
    app.use(async (c, next) => {
      c.set("userAddress", WALLET);
      await next();
    });
    app.post("/generate", generationRateLimit, (c) => c.json({ ok: true }));
    return app;
  }

  const post = (app, body) =>
    app.request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    _resetRateLimiters();
    process.env.GENERATION_RATE_LIMIT_MAX = "2";
    delete process.env.MOCK_3D_GENERATION;
  });

  afterEach(() => {
    delete process.env.GENERATION_RATE_LIMIT_MAX;
  });

  it("counts mock requests toward the generation limit", async () => {
    const app = buildApp();
    expect((await post(app, { provider: "mock" })).status).toBe(200);
    expect((await post(app, { provider: "mock" })).status).toBe(200);
    const third = await post(app, { provider: "mock" });
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("RATE_LIMITED");
  });

  it("lets BYOK tripo3d requests skip the generation limit", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i += 1) {
      const res = await post(app, { provider: "tripo3d", providerKey: "user-key" });
      expect(res.status).toBe(200);
    }
  });

  it("counts tripo3d requests without providerKey", async () => {
    const app = buildApp();
    expect((await post(app, { provider: "tripo3d" })).status).toBe(200);
    expect((await post(app, { provider: "tripo3d" })).status).toBe(200);
    expect((await post(app, { provider: "tripo3d" })).status).toBe(429);
  });

  it("does not bypass on a whitespace-only providerKey", async () => {
    const app = buildApp();
    expect((await post(app, { provider: "tripo3d", providerKey: "   " })).status).toBe(200);
    expect((await post(app, { provider: "tripo3d", providerKey: "   " })).status).toBe(200);
    expect((await post(app, { provider: "tripo3d", providerKey: "   " })).status).toBe(429);
  });
});
