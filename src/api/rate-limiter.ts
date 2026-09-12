/**
 * Arbesk Express rate limiters.
 * @remarks Authenticated routes key limits by wallet address
 *   (`res.locals.userAddress`); unauthenticated routes fall back to req.ip.
 */

import rateLimit, { MemoryStore } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import {
  DEFAULT_WINDOW_MS, LIMITER_SPECS, isByokBody,
} from "../shared/rate-limit-specs.ts";

type MaxOption =
  | number
  | ((req: Request, res: Response) => number);

interface LimiterOptions {
  max: MaxOption;
  windowMs?: number;
  message?: string;
}

function walletKeyGenerator(req: Request, res: Response): string {
  return res.locals.userAddress || req.ip || "unknown";
}

function createLimiter({ max, windowMs = DEFAULT_WINDOW_MS, message }: LimiterOptions) {
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

/** Creates a one-off rate-limit middleware. */
export default function createRateLimitMiddleware({
  max,
  windowMs = DEFAULT_WINDOW_MS,
  message,
}: LimiterOptions) {
  return createLimiter({ max, windowMs, message }).middleware;
}

// Policy comes from src/shared/rate-limit-specs.ts; this file is only the
// express-rate-limit adapter for it. Built by iterating the table rather than
// naming each limiter, so adding one is a single edit in the shared table and
// the reset below cannot fall out of sync with it.
const limiters = Object.fromEntries(
  Object.entries(LIMITER_SPECS).map(([name, spec]) => [name, createLimiter(spec)]),
);

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
export const generationRateLimit = (req: Request, res: Response, next: NextFunction) => {
  if (isByokBody(req.body)) return next();
  return limiters.generation.middleware(req, res, next);
};

/**
 * Resets all in-memory rate-limit stores.
 * @remarks Iterates the table: a limiter added to the shared specs is reset
 *   automatically, where the previous hand-written list silently was not.
 */
export function _resetRateLimiters(): void {
  for (const limiter of Object.values(limiters)) limiter.store.resetAll();
}
