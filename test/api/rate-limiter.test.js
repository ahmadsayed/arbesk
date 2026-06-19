import { jest } from "@jest/globals";
import rateLimit, { _resetRateLimiter } from "../../src/api/rate-limiter.js";

function run(mw, { userAddress, ip }) {
  const req = { body: {}, ip };
  const res = {
    locals: userAddress ? { userAddress } : {},
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe("rate limiter keying", () => {
  beforeEach(() => _resetRateLimiter());

  it("keys on res.locals.userAddress even without txHash", () => {
    const mw = rateLimit({ max: 2, windowMs: 60000 });
    expect(run(mw, { userAddress: "0xWallet", ip: "1.1.1.1" }).nextCalled).toBe(
      true,
    );
    expect(run(mw, { userAddress: "0xWallet", ip: "2.2.2.2" }).nextCalled).toBe(
      true,
    );
    const third = run(mw, { userAddress: "0xWallet", ip: "3.3.3.3" });
    expect(third.nextCalled).toBe(false);
    expect(third.res.statusCode).toBe(429);
  });

  it("falls back to req.ip when no session address", () => {
    const mw = rateLimit({ max: 1, windowMs: 60000 });
    expect(run(mw, { ip: "9.9.9.9" }).nextCalled).toBe(true);
    expect(run(mw, { ip: "9.9.9.9" }).nextCalled).toBe(false);
  });
});
