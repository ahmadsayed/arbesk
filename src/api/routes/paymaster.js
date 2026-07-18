import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import { paymasterRateLimit } from "../rate-limiter.js";

const Router = express.Router;

/**
 * Paymaster proxy routes.
 *
 * POST /api/v1/paymaster
 * Forwards bundler/paymaster JSON-RPC calls to CDP_PAYMASTER_URL.
 * The API key is embedded in CDP_PAYMASTER_URL — it never reaches the browser.
 *
 * Auth: Session token required + wallet-keyed rate limit (default 30/min,
 * PAYMASTER_RATE_LIMIT_MAX) — every proxied call spends the deployment's CDP
 * paymaster quota. Only standard ERC-4337 paymaster JSON-RPC methods (`pm_*`)
 * are forwarded; anything else is rejected with PAYMASTER_METHOD_NOT_ALLOWED.
 */
export default function paymasterRoutes() {
  const router = Router();

  /**
   * POST /api/v1/paymaster
   * Accepts a standard JSON-RPC body and proxies it verbatim to the CDP
   * Paymaster URL. Returns CDP's response body and status code unchanged.
   *
   * Returns 503 if CDP_PAYMASTER_URL is not configured.
   */
  router.post("/", authenticate, paymasterRateLimit, async (req, res) => {
    const paymasterUrl = process.env.CDP_PAYMASTER_URL;

    if (!paymasterUrl) {
      console.warn("[PAYMASTER] CDP_PAYMASTER_URL not configured — returning 503");
      return sendError(res, 503, "PAYMASTER_NOT_CONFIGURED", "CDP Paymaster URL is not set");
    }

    const method = req.body?.method ?? "(unknown)";
    const id = req.body?.id ?? null;

    if (typeof method !== "string" || !method.startsWith("pm_")) {
      console.warn(`[PAYMASTER] rejected non-paymaster method=${method}`);
      return sendError(
        res,
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
        body: JSON.stringify(req.body),
      });

      const text = await upstream.text();
      console.log(`[PAYMASTER] response status=${upstream.status} method=${method}`);

      res.status(upstream.status).set("Content-Type", "application/json").send(text);
    } catch (error) {
      console.error("[PAYMASTER] upstream fetch failed:", (/** @type {Error} */ (error)).message);
      sendError(res, 502, "PAYMASTER_UPSTREAM_ERROR", (/** @type {Error} */ (error)).message);
    }
  });

  return router;
}
