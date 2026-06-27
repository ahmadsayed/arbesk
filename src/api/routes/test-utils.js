import express from "express";
import { _resetRateLimiters } from "../rate-limiter.js";

const Router = express.Router;

/**
 * Test-only utilities. Not mounted in production.
 */
export default function testUtilsRoutes() {
  const router = Router();

  router.post("/reset-rate-limit", (req, res) => {
    _resetRateLimiters();
    console.log("[RATE-LIMIT] reset via test endpoint");
    res.json({ ok: true });
  });

  return router;
}
