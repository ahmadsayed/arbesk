import { Hono } from "hono";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import type { AuthEnv } from "../authentication.ts";
import { paymasterRateLimit } from "../rate-limiter.ts";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Paymaster proxy routes: forwards bundler/paymaster JSON-RPC calls to
 * CDP_PAYMASTER_URL.
 * @remarks The API key is embedded in CDP_PAYMASTER_URL and never reaches the
 *   browser. Only standard ERC-4337 `pm_*` methods are forwarded (others are
 *   rejected with PAYMASTER_METHOD_NOT_ALLOWED).
 */
export default function paymasterRoutes() {
  const app = new Hono<AuthEnv>();

  /**
   * POST /api/v1/paymaster
   *
   * Proxies a standard JSON-RPC body verbatim to the CDP Paymaster URL.
   * @remarks Returns CDP's response body and status code unchanged; 503 when
   *   CDP_PAYMASTER_URL is not configured.
   */
  app.post("/", authenticate, paymasterRateLimit, async (c) => {
    const paymasterUrl = process.env.CDP_PAYMASTER_URL;

    if (!paymasterUrl) {
      console.warn("[PAYMASTER] CDP_PAYMASTER_URL not configured — returning 503");
      return sendError(c, 503, "PAYMASTER_NOT_CONFIGURED", "CDP Paymaster URL is not set");
    }

    // Proxied verbatim, so the body is read as-is rather than validated; a body
    // that will not parse is rejected below as a non-pm_* method.
    const body: { method?: unknown; id?: unknown } | null = await c.req
      .json()
      .catch(() => null);
    const method = body?.method ?? "(unknown)";
    const id = body?.id ?? null;

    if (typeof method !== "string" || !method.startsWith("pm_")) {
      console.warn(`[PAYMASTER] rejected non-paymaster method=${method}`);
      return sendError(
        c,
        400,
        "PAYMASTER_METHOD_NOT_ALLOWED",
        `Only pm_* paymaster JSON-RPC methods are proxied (got: ${method})`,
      );
    }

    console.log(`[PAYMASTER] forwarding method=${method} id=${id}`);

    try {
      const upstream = await fetch(paymasterUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await upstream.text();
      console.log(`[PAYMASTER] response status=${upstream.status} method=${method}`);

      return c.body(text, upstream.status as ContentfulStatusCode, {
        "Content-Type": "application/json",
      });
    } catch (error) {
      console.error("[PAYMASTER] upstream fetch failed:", (error as Error).message);
      return sendError(c, 502, "PAYMASTER_UPSTREAM_ERROR", (error as Error).message);
    }
  });

  return app;
}
