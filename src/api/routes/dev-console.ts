import express from "express";
import type { Request, Response } from "express";

/**
 * Dev-only browser console bridge (diagnostics sink).
 *
 * The frontend ships a small console shim (frontend/src/pug/includes/head.pug)
 * that overrides `console.*`, `window.onerror`, and `unhandledrejection`, then
 * POSTs batches here. Each entry is echoed to stdout with a `[BROWSER]` tag so
 * the DeepSeek Harness side-viewer's console (which tails the backend stdout)
 * can surface browser-side logs alongside the Node logs.
 *
 * Fire-and-forget: reads nothing, writes nothing, always succeeds.
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
