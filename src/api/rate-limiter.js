/**
 * Arbesk Express Rate Limiters
 *
 * Replaces the custom in-memory map with express-rate-limit for proper
 * fixed/sliding windows, standard RateLimit-* headers, and per-route stores
 * that can be reset in tests.
 *
 * All authenticated routes key the limit by wallet address (res.locals.userAddress);
 * unauthenticated routes fall back to req.ip.
 */

import rateLimit, { MemoryStore } from "express-rate-limit";

const DEFAULT_WINDOW_MS = 60 * 1000;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function walletKeyGenerator(req, res) {
  return res.locals.userAddress || req.ip || "unknown";
}

/**
 * @param {{
 *   max: number | ((req: import('express').Request, res: import('express').Response) => number);
 *   windowMs?: number;
 *   message?: string;
 * }} options
 */
function createLimiter({ max, windowMs = DEFAULT_WINDOW_MS, message }) {
  const store = new MemoryStore();

  const middleware = rateLimit({
    windowMs,
    max: typeof max === "function" ? max : () => max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: walletKeyGenerator,
    validate: { keyGeneratorIpFallback: false },
    handler: (req, res, _next, options) => {
      const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message:
            message ||
            `Limit: ${options.max} requests per ${options.windowMs / 1000}s`,
          details: {
            retryAfterSeconds,
          },
        },
      });
    },
    store,
  });

  return { middleware, store };
}

/**
 * Factory for creating a one-off rate-limit middleware (used by tests and any
 * future route that needs a custom limit).
 *
 * @param {{
 *   max: number | ((req: import('express').Request, res: import('express').Response) => number);
 *   windowMs?: number;
 *   message?: string;
 * }} options
 */
export default function createRateLimitMiddleware({
  max,
  windowMs = DEFAULT_WINDOW_MS,
  message,
}) {
  return createLimiter({ max, windowMs, message }).middleware;
}

const uploadUrlLimiter = createLimiter({
  max: () => Number(process.env.UPLOAD_URL_RATE_LIMIT_MAX || 20),
  message: "Upload credential rate limit exceeded.",
});

const generationLimiter = createLimiter({
  max: () =>
    Number(
      process.env.GENERATION_RATE_LIMIT_MAX ||
        (process.env.MOCK_3D_GENERATION === "true" ? 1000 : 10),
    ),
  windowMs: 60 * 60 * 1000,
  message: "Generation rate limit exceeded.",
});

/**
 * BYOK (Bring Your Own Key) requests bypass the server-side generation rate
 * limit because the caller is consuming their own provider quota.
 *
 * @param {import('express').Request} req
 */
function isByok(req) {
  const provider = req.body?.provider;
  const providerKey = req.body?.providerKey;
  return (
    typeof provider === "string" &&
    provider.length > 0 &&
    provider !== "mock" &&
    typeof providerKey === "string" &&
    providerKey.trim().length > 0
  );
}

const unpinLimiter = createLimiter({
  max: () => Number(process.env.UNPIN_RATE_LIMIT_MAX || 30),
  message: "Unpin rate limit exceeded.",
});

const gcLimiter = createLimiter({
  max: () => Number(process.env.GC_RATE_LIMIT_MAX || 10),
  windowMs: 60 * 60 * 1000, // 1 hour
  message: "GC rate limit exceeded.",
});

const paymasterLimiter = createLimiter({
  max: () => Number(process.env.PAYMASTER_RATE_LIMIT_MAX || 30),
  message: "Paymaster rate limit exceeded.",
});

const userResolveLimiter = createLimiter({
  max: () => Number(process.env.USER_RESOLVE_RATE_LIMIT_MAX || 10),
  message: "Email resolution rate limit exceeded.",
});

export const uploadUrlRateLimit = uploadUrlLimiter.middleware;
export const unpinRateLimit = unpinLimiter.middleware;
export const gcRateLimit = gcLimiter.middleware;
export const paymasterRateLimit = paymasterLimiter.middleware;
export const userResolveRateLimit = userResolveLimiter.middleware;

/**
 * Generation rate-limit middleware. BYOK requests skip the server-side limit
 * and call next() directly; all other generation requests count toward the
 * global generation limit.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const generationRateLimit = (req, res, next) => {
  if (isByok(req)) return next();
  return generationLimiter.middleware(req, res, next);
};

/**
 * Reset all in-memory rate-limit stores. Used by test teardown.
 */
export function _resetRateLimiters() {
  uploadUrlLimiter.store.resetAll();
  generationLimiter.store.resetAll();
  unpinLimiter.store.resetAll();
  gcLimiter.store.resetAll();
  paymasterLimiter.store.resetAll();
  userResolveLimiter.store.resetAll();
}
