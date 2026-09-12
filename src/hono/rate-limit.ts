/**
 * Hono in-house fixed-window rate limiters — replaces the express-rate-limit
 * usage in src/api/rate-limiter.ts.
 * @remarks Authenticated routes key limits by wallet address
 *   (`c.get("userAddress")`); unauthenticated routes fall back to the client
 *   IP. Emits the same IETF draft-6 `RateLimit-*` headers and the same 429
 *   envelope as the Express version.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import {
  DEFAULT_WINDOW_MS, LIMITER_SPECS, isByokBody,
} from "../shared/rate-limit-specs.ts";

type MaxOption = number | ((c: Context) => number);

interface LimiterOptions {
  max: MaxOption;
  windowMs?: number;
  message?: string;
}

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface Limiter {
  middleware: MiddlewareHandler;
  reset: () => void;
}

interface RateLimitVariables {
  userAddress?: string;
}

function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-process test servers (app.request) have no socket.
    return "test";
  }
}

function createLimiter({
  max,
  windowMs = DEFAULT_WINDOW_MS,
  message,
}: LimiterOptions): Limiter {
  const counters = new Map<string, WindowCounter>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, counter] of counters) {
      if (counter.resetAt <= now) counters.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  const middleware: MiddlewareHandler<{
    Variables: RateLimitVariables;
  }> = async (c, next) => {
    const limit = typeof max === "function" ? max(c) : max;
    const key = c.get("userAddress") || clientIp(c);
    const now = Date.now();
    let counter = counters.get(key);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + windowMs };
      counters.set(key, counter);
    }
    counter.count += 1;

    const windowSeconds = Math.ceil(windowMs / 1000);
    const resetSeconds = Math.max(0, Math.ceil((counter.resetAt - now) / 1000));
    const remaining = Math.max(0, limit - counter.count);
    c.header("RateLimit-Policy", `${limit};w=${windowSeconds}`);
    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(remaining));
    c.header("RateLimit-Reset", String(resetSeconds));

    if (counter.count > limit) {
      c.header("Retry-After", String(resetSeconds));
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message:
              message || `Limit: ${limit} requests per ${windowSeconds}s`,
            details: {
              retryAfterSeconds: windowSeconds,
            },
          },
        },
        429,
      );
    }
    await next();
  };

  return { middleware, reset: () => counters.clear() };
}

/**
 * Creates a one-off rate-limit middleware.
 */
export default function createRateLimitMiddleware({
  max,
  windowMs = DEFAULT_WINDOW_MS,
  message,
}: LimiterOptions): MiddlewareHandler {
  return createLimiter({ max, windowMs, message }).middleware;
}

// Policy comes from src/shared/rate-limit-specs.ts; this file is only the Hono
// adapter for it. Built by iterating the table rather than naming each limiter,
// so adding one is a single edit in the shared table and the reset below cannot
// fall out of sync with it.
const limiters = Object.fromEntries(
  Object.entries(LIMITER_SPECS).map(([name, spec]) => [name, createLimiter(spec)]),
);

/**
 * BYOK (Bring Your Own Key) requests bypass the server-side generation rate
 * limit.
 * @remarks The caller consumes their own provider quota. Hono has to read the
 *   body itself to decide, where Express had it already parsed; a body that
 *   will not parse is not BYOK.
 */
async function isByokRequest(c: Context): Promise<boolean> {
  try {
    return isByokBody(await c.req.json());
  } catch {
    return false;
  }
}

export const uploadUrlRateLimit = limiters.uploadUrl.middleware;
export const unpinRateLimit = limiters.unpin.middleware;
export const gcRateLimit = limiters.gc.middleware;
export const paymasterRateLimit = limiters.paymaster.middleware;
export const userResolveRateLimit = limiters.userResolve.middleware;
export const emailOtpRequestRateLimit = limiters.emailOtpRequest.middleware;
export const emailOtpVerifyRateLimit = limiters.emailOtpVerify.middleware;
export const walletRelayRateLimit = limiters.walletRelay.middleware;
export const cadRateLimit = limiters.cad.middleware;

/**
 * Generation rate-limit middleware.
 * @remarks BYOK requests skip the server-side limit; all other generation
 *   requests count toward the global limit.
 */
export const generationRateLimit: MiddlewareHandler = async (c, next) => {
  if (await isByokRequest(c)) return next();
  return limiters.generation.middleware(c, next);
};

/**
 * Resets all in-memory rate-limit stores.
 * @remarks Iterates the table: a limiter added to the shared specs is reset
 *   automatically, where the previous hand-written list silently was not.
 */
export function _resetRateLimiters(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
}
