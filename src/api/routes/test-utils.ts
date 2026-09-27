import { Hono } from "hono";
import { _resetRateLimiters } from "../rate-limiter.ts";

/**
 * Test-only utilities. Not mounted in production.
 */
export default function testUtilsRoutes() {
  const app = new Hono();

  app.post("/reset-rate-limit", (c) => {
    _resetRateLimiters();
    console.log("[RATE-LIMIT] reset via test endpoint");
    return c.json({ ok: true });
  });

  return app;
}
