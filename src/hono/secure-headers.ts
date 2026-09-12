/**
 * Hono security-headers middleware — the Hono side of the helmet
 * configuration in src/index.ts: report-only CSP, COOP
 * `same-origin-allow-popups`, frameguard OFF (no X-Frame-Options), COEP off.
 *
 * @remarks hono/secure-headers is deliberately not used: it has no
 *   report-only CSP support, and the policy is still in Report-Only mode.
 *
 *   The directive map itself lives in src/shared/csp.ts. It was copied here
 *   when this module was ported, which meant the Express and Hono servers
 *   could enforce DIFFERENT security policies with nothing to report it — the
 *   failure would surface as a blocked request in a browser console. Both
 *   stacks now read one map, so they cannot drift while the migration runs.
 */

import { buildCspDirectives, buildCspHeaderValue } from "../shared/csp.ts";
import type { MiddlewareHandler } from "hono";

// Re-exported so this module remains the single import site for its
// consumers (and for test/api/hono-secure-headers.test.js).
export { buildCspDirectives, buildCspHeaderValue };

/**
 * Hono middleware setting the report-only CSP and COOP headers.
 * @remarks Deliberately does NOT set X-Frame-Options (frameguard off) or
 *   Cross-Origin-Embedder-Policy, matching the Express configuration.
 * @returns A middleware that sets both headers and continues the chain.
 */
export function secureHeaders(): MiddlewareHandler {
  return async (c, next) => {
    c.header("Content-Security-Policy-Report-Only", buildCspHeaderValue());
    c.header("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    await next();
  };
}
