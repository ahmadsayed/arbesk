/**
 * Arbesk fixed-window rate limiters.
 * @remarks Authenticated routes key limits by wallet address
 *   (`c.get("userAddress")`); unauthenticated routes fall back to the client
 *   IP. Emits IETF draft-6 `RateLimit-*` headers and the standard 429
 *   error envelope.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

/** Window applied when a spec does not name one. */
export const DEFAULT_WINDOW_MS = 60 * 1000;

const MINUTE_MS = 60 * 1000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** One limiter's policy. */
export interface LimiterSpec {
  /** Read per request, so an operator override applies without a restart. */
  max: () => number;
  windowMs?: number;
  message: string;
}

/**
 * Every limiter this server applies, keyed by the name its middleware is
 * exported under.
 * @remarks `max` is always a function, never a bare number: a number would be
 *   captured at module load, which is before a test can set its env var.
 */
export const LIMITER_SPECS: Record<string, LimiterSpec> = {
  uploadUrl: {
    max: () => Number(process.env.UPLOAD_URL_RATE_LIMIT_MAX || 20),
    message: "Upload credential rate limit exceeded.",
  },
  generation: {
    max: () =>
      Number(
        process.env.GENERATION_RATE_LIMIT_MAX ||
          (process.env.MOCK_3D_GENERATION === "true" ? 1000 : 10),
      ),
    windowMs: HOUR_MS,
    message: "Generation rate limit exceeded.",
  },
  unpin: {
    max: () => Number(process.env.UNPIN_RATE_LIMIT_MAX || 30),
    message: "Unpin rate limit exceeded.",
  },
  gc: {
    max: () => Number(process.env.GC_RATE_LIMIT_MAX || 10),
    windowMs: HOUR_MS, // 1 hour
    message: "GC rate limit exceeded.",
  },
  paymaster: {
    max: () => Number(process.env.PAYMASTER_RATE_LIMIT_MAX || 30),
    message: "Paymaster rate limit exceeded.",
  },
  userResolve: {
    max: () => Number(process.env.USER_RESOLVE_RATE_LIMIT_MAX || 10),
    message: "Email resolution rate limit exceeded.",
  },
  emailOtpRequest: {
    max: () => Number(process.env.EMAIL_OTP_REQUEST_RATE_LIMIT_MAX || 5),
    windowMs: QUARTER_HOUR_MS,
    message: "Too many code requests. Try again later.",
  },
  emailOtpVerify: {
    max: () => Number(process.env.EMAIL_OTP_VERIFY_RATE_LIMIT_MAX || 10),
    windowMs: QUARTER_HOUR_MS,
    message: "Too many verification attempts. Request a new code.",
  },
  walletRelay: {
    max: () => Number(process.env.WALLET_RELAY_RATE_LIMIT_MAX || 30),
    windowMs: MINUTE_MS,
    message: "Wallet relay rate limit exceeded.",
  },
  /**
   * Hourly, and deliberately well under the generation limiter's: this bounds
   * bursts INSIDE the daily round quota, which is the spend guard. A client
   * that repairs in a tight loop is exactly the shape this cap exists for.
   */
  cad: {
    max: () => Number(process.env.CAD_RATE_LIMIT_MAX || 20),
    windowMs: HOUR_MS,
    message: "CAD request rate limit exceeded.",
  },
};

/**
 * Whether a request body means the caller brings their own provider key.
 *
 * @remarks BYOK requests skip the server-side generation limit — the caller
 *   consumes their own provider quota.
 * @param body The parsed request body, or anything else.
 * @returns True when a non-mock provider key was supplied.
 */
export function isByokBody(body: unknown): boolean {
  const { provider, providerKey } = (body ?? {}) as {
    provider?: unknown;
    providerKey?: unknown;
  };
  return (
    typeof provider === "string" &&
    provider.length > 0 &&
    provider !== "mock" &&
    typeof providerKey === "string" &&
    providerKey.trim().length > 0
  );
}

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

// Built by iterating the table rather than naming each limiter, so adding one
// is a single edit in LIMITER_SPECS and the reset below cannot fall out of
// sync with it.
const limiters = Object.fromEntries(
  Object.entries(LIMITER_SPECS).map(([name, spec]) => [name, createLimiter(spec)]),
);

/**
 * BYOK (Bring Your Own Key) requests bypass the server-side generation rate
 * limit.
 * @remarks The caller consumes their own provider quota. The body is read
 *   here (Hono caches it for the validator); a body that will not parse is
 *   not BYOK.
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
 * @remarks Iterates the table, so a limiter added to LIMITER_SPECS is reset
 *   automatically.
 */
export function _resetRateLimiters(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
}
