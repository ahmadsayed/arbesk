/**
 * POST /api/v1/followup-intent - what a typed follow-up on a mesh asks for.
 * @remarks Server-side only because the Jev key is a secret (ARCHITECTURE
 *   section 1.5); the routing policy itself lives in the client. Every failure
 *   is a non-2xx the client treats as "no reading" and keeps its default route,
 *   so Jev being down never blocks a follow-up.
 */
import { Hono } from "hono";
import { JevError } from "@arbesk/cad-gen/backend/index.js";
import { judgeFollowup } from "../followup-intent.ts";
import { followupIntentSchema } from "../schemas.ts";
import { validateBody } from "../validation.ts";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import type { AuthEnv } from "../authentication.ts";
import { followupIntentRateLimit } from "../rate-limiter.ts";

export interface FollowupIntentDeps {
  /** Jev transport, injected by tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Jev wiring from the environment, read per request.
 * @returns null when JEV_API_KEY is unset.
 */
function jevConfig(fetchImpl?: typeof fetch) {
  const apiKey = (process.env.JEV_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.JEV_BASE_URL ?? "").trim();
  const model = (process.env.JEV_MODEL ?? "").trim();
  return {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

export default function followupIntentRoutes(deps: FollowupIntentDeps = {}) {
  const app = new Hono<AuthEnv>();

  app.post("/", authenticate, followupIntentRateLimit, validateBody(followupIntentSchema), async (c) => {
    const config = jevConfig(deps.fetchImpl);
    if (!config) {
      return sendError(c, 503, "FOLLOWUP_INTENT_UNAVAILABLE", "Follow-up intent is not configured");
    }
    try {
      return c.json(await judgeFollowup(config, c.req.valid("json"), c.req.raw.signal));
    } catch (err) {
      if (!(err instanceof JevError)) throw err;
      console.warn(`[FOLLOWUP-INTENT] jev failed: ${err.message}`);
      return sendError(c, 502, "FOLLOWUP_INTENT_FAILED", "Could not read the follow-up");
    }
  });

  return app;
}
