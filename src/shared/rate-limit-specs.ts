/**
 * The rate-limit table, shared by the Express and Hono adapters.
 *
 * @remarks Extracted from two byte-identical copies. Every limiter definition
 *   — its env var, its default, its window and its message — was duplicated
 *   when the Hono adapters were ported. A rate limit is a security control,
 *   and two copies means tuning one default leaves the OTHER stack enforcing
 *   the old number, with nothing anywhere to report it. The adapters differ
 *   only in how they recognise a BYOK request and how they hand the limiter
 *   its context; the policy itself is data and lives here once.
 */

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
 *   consumes their own provider quota. Framework-agnostic on purpose: the
 *   Express adapter passes `req.body` and the Hono adapter passes the result of
 *   `await c.req.json()`, and both land here with a plain object.
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
