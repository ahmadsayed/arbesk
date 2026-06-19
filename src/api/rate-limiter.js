const rateMap = new Map(); // walletAddress → { count, resetTime }

// Exposed for test teardown
export function _resetRateLimiter() {
  rateMap.clear();
}

export default function rateLimit({ max, windowMs }) {
  return (req, res, next) => {
    // Prefer the authenticated wallet (set by the authenticate middleware,
    // which runs before this limiter). Fall back to IP for unauthenticated routes.
    const wallet = res.locals.userAddress || req.ip;

    if (!wallet) return next();

    const now = Date.now();
    const entry = rateMap.get(wallet) || {
      count: 0,
      resetTime: now + windowMs,
    };

    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + windowMs;
    }

    entry.count += 1;
    rateMap.set(wallet, entry);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: `Limit: ${max} requests per ${windowMs / 1000}s`,
          details: {
            retryAfterSeconds: retryAfter,
          },
        },
      });
    }

    next();
  };
}
