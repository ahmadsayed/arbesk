const rateMap = new Map(); // walletAddress → { count, resetTime }

export default function rateLimit({ max, windowMs }) {
    return (req, res, next) => {
        const wallet = req.body.txHash
            ? res.locals.userAddress // set by authenticate middleware
            : req.ip; // fallback for unauthenticated routes

        if (!wallet) return next();

        const now = Date.now();
        const entry = rateMap.get(wallet) || { count: 0, resetTime: now + windowMs };

        if (now > entry.resetTime) {
            entry.count = 0;
            entry.resetTime = now + windowMs;
        }

        entry.count += 1;
        rateMap.set(wallet, entry);

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));

        if (entry.count > max) {
            return res.status(429).json({
                error: 'RATE_LIMITED',
                message: `Limit: ${max} requests per ${windowMs / 1000}s`,
                retryAfter: Math.ceil((entry.resetTime - now) / 1000)
            });
        }

        next();
    };
}
