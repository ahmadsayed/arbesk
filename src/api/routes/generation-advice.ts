/**
 * POST /api/v1/generation-advice - which engine and Tripo config fit a request.
 * @remarks Server-side only because the Jev key is a secret (ARCHITECTURE
 *   section 1.5). Every failure is a non-2xx the client treats as "no advice"
 *   and keeps its default engine/config, so Jev being down never blocks a
 *   generation.
 */
import { Hono } from "hono";
import { JevError } from "@arbesk/cad-gen/backend/index.js";
import { judgeGenerationAdvice } from "../generation-advice.ts";
import { generationAdviceSchema } from "../schemas.ts";
import { validateBody } from "../validation.ts";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import type { AuthEnv } from "../authentication.ts";
import { generationAdviceRateLimit } from "../rate-limiter.ts";
import { jevConfig } from "./jev-env.ts";
import type { JevRouteDeps } from "./jev-env.ts";

export type GenerationAdviceDeps = JevRouteDeps;

export default function generationAdviceRoutes(deps: GenerationAdviceDeps = {}) {
  const app = new Hono<AuthEnv>();

  app.post("/", authenticate, generationAdviceRateLimit, validateBody(generationAdviceSchema), async (c) => {
    const config = jevConfig(deps.fetchImpl);
    if (!config) {
      return sendError(c, 503, "GENERATION_ADVICE_UNAVAILABLE", "Generation advice is not configured");
    }
    const body = c.req.valid("json");
    try {
      return c.json(await judgeGenerationAdvice(
        config,
        { prompt: body.prompt, hasImage: body.hasImage, cadAvailable: body.cadAvailable ?? false },
        c.req.raw.signal,
      ));
    } catch (err) {
      if (err instanceof JevError) {
        // 4xx statuses (e.g. an upstream 429) are meaningful to the client;
        // anything else, including a Jev-side 5xx, reads here as bad gateway.
        const status = err.status >= 400 && err.status < 500 ? err.status : 502;
        console.warn(`[GENERATION-ADVICE] jev failed: ${err.message}`);
        return sendError(c, status, "GENERATION_ADVICE_FAILED", "Could not advise on the generation");
      }
      console.error(`[ERR] [GENERATION-ADVICE] unexpected: ${(err as Error).message}`);
      return sendError(c, 500, "GENERATION_ADVICE_FAILED", "Could not advise on the generation");
    }
  });

  return app;
}
