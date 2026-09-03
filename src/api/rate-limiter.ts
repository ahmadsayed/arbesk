/**
 * Arbesk Express rate limiters.
 * @remarks Authenticated routes key limits by wallet address
 *   (`res.locals.userAddress`); unauthenticated routes fall back to req.ip.
 */

import rateLimit, { MemoryStore } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";

const DEFAULT_WINDOW_MS = 60 * 1000;

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
 * limit.
 * @remarks The caller consumes their own provider quota.
 */
function isByok(req: Request): boolean {
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

const emailOtpRequestLimiter = createLimiter({
  max: () => Number(process.env.EMAIL_OTP_REQUEST_RATE_LIMIT_MAX || 5),
  windowMs: 15 * 60 * 1000,
  message: "Too many code requests. Try again later.",
});

const emailOtpVerifyLimiter = createLimiter({
  max: () => Number(process.env.EMAIL_OTP_VERIFY_RATE_LIMIT_MAX || 10),
  windowMs: 15 * 60 * 1000,
  message: "Too many verification attempts. Request a new code.",
});

const walletRelayLimiter = createLimiter({
  max: () => Number(process.env.WALLET_RELAY_RATE_LIMIT_MAX || 30),
  windowMs: 60 * 1000,
  message: "Wallet relay rate limit exceeded.",
});

export const uploadUrlRateLimit = uploadUrlLimiter.middleware;
export const unpinRateLimit = unpinLimiter.middleware;
export const gcRateLimit = gcLimiter.middleware;
export const paymasterRateLimit = paymasterLimiter.middleware;
export const userResolveRateLimit = userResolveLimiter.middleware;
export const emailOtpRequestRateLimit = emailOtpRequestLimiter.middleware;
export const emailOtpVerifyRateLimit = emailOtpVerifyLimiter.middleware;
export const walletRelayRateLimit = walletRelayLimiter.middleware;

/**
 * Generation rate-limit middleware.
 * @remarks BYOK requests skip the server-side limit; all other generation
 *   requests count toward the global limit.
 */
export const generationRateLimit = (req: Request, res: Response, next: NextFunction) => {
  if (isByok(req)) return next();
  return generationLimiter.middleware(req, res, next);
};

/** Resets all in-memory rate-limit stores. */
export function _resetRateLimiters(): void {
  uploadUrlLimiter.store.resetAll();
  generationLimiter.store.resetAll();
  unpinLimiter.store.resetAll();
  gcLimiter.store.resetAll();
  paymasterLimiter.store.resetAll();
  userResolveLimiter.store.resetAll();
  emailOtpRequestLimiter.store.resetAll();
  emailOtpVerifyLimiter.store.resetAll();
  walletRelayLimiter.store.resetAll();
}
