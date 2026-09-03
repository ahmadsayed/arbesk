import express from "express";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import { paymasterRateLimit } from "../rate-limiter.ts";

const Router = express.Router;

/**
 * Paymaster proxy routes: forwards bundler/paymaster JSON-RPC calls to
 * CDP_PAYMASTER_URL.
 * @remarks The API key is embedded in CDP_PAYMASTER_URL and never reaches the
 *   browser. Only standard ERC-4337 `pm_*` methods are forwarded (others are
 *   rejected with PAYMASTER_METHOD_NOT_ALLOWED).
 */
export default function paymasterRoutes() {
  const router = Router();

  /**
   * POST /api/v1/paymaster
   *
   * Proxies a standard JSON-RPC body verbatim to the CDP Paymaster URL.
   * @remarks Returns CDP's response body and status code unchanged; 503 when
   *   CDP_PAYMASTER_URL is not configured.
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
      console.error("[PAYMASTER] upstream fetch failed:", (error as Error).message);
      sendError(res, 502, "PAYMASTER_UPSTREAM_ERROR", (error as Error).message);
    }
  });

  return router;
}
