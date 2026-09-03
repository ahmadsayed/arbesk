import express from "express";
import type { Request, Response } from "express";

/**
 * Dev-only browser console bridge (diagnostics sink).
 * @remarks Echoes each entry to stdout with a `[BROWSER]` tag so the
 *   side-viewer's console (which tails backend stdout) can surface
 *   browser-side logs alongside Node logs. Fire-and-forget: always succeeds.
 */
export default () => {
  const router = express.Router();

  router.post("/console", (req: Request, res: Response) => {
    const body = req.body;
    const entries = Array.isArray(body?.entries) ? body.entries : [body];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const level = typeof entry.level === "string" ? entry.level : "log";
      const raw =
        typeof entry.text === "string" ? entry.text : JSON.stringify(entry);
      // Keep each entry on one line so the [BROWSER] prefix stays line-anchored
      // for the side-viewer's log splitter.
      const text = raw.replace(/\n/g, " ").replace(/\r/g, "");
      console.log(`[BROWSER] ${level} ${text}`);
    }

    res.status(204).end();
  });

  return router;
};
