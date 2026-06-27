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
});
