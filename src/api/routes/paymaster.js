import express from "express";
import { sendError } from "../errors.js";

const Router = express.Router;

/**
 * Paymaster proxy routes.
 *
 * POST /api/v1/paymaster
 * Forwards bundler/paymaster JSON-RPC calls to CDP_PAYMASTER_URL.
 * The API key is embedded in CDP_PAYMASTER_URL — it never reaches the browser.
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
  router.post("/", async (req, res) => {
    const paymasterUrl = process.env.CDP_PAYMASTER_URL;

    if (!paymasterUrl) {
      console.warn("[PAYMASTER] CDP_PAYMASTER_URL not configured — returning 503");
      return sendError(res, 503, "PAYMASTER_NOT_CONFIGURED", "CDP Paymaster URL is not set");
    }

    const method = req.body?.method ?? "(unknown)";
    const id = req.body?.id ?? null;
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
