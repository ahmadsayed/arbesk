import { createRequest, createResponse } from "node-mocks-http";
import createRateLimitMiddleware, {
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
