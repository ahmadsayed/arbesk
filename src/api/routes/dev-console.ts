import { Hono } from "hono";

/**
 * Dev-only browser console bridge (diagnostics sink).
 * @remarks Echoes each entry to stdout with a `[BROWSER]` tag so the
 *   side-viewer's console (which tails backend stdout) can surface
 *   browser-side logs alongside Node logs. Fire-and-forget: always succeeds.
 */
export default () => {
  const app = new Hono();

  app.post("/console", async (c) => {
    // Express handed an unparseable or non-JSON body through as {}; keep that.
    const body: unknown = await c.req.json().catch(() => ({}));
    const entries = Array.isArray((body as { entries?: unknown })?.entries)
      ? (body as { entries: unknown[] }).entries
      : [body];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const { level: rawLevel, text: rawText } = entry as {
        level?: unknown;
        text?: unknown;
      };
      const level = typeof rawLevel === "string" ? rawLevel : "log";
      const raw = typeof rawText === "string" ? rawText : JSON.stringify(entry);
      // Keep each entry on one line so the [BROWSER] prefix stays line-anchored
      // for the side-viewer's log splitter.
      const text = raw.replace(/\n/g, " ").replace(/\r/g, "");
      console.log(`[BROWSER] ${level} ${text}`);
    }

    return c.body(null, 204);
  });

  return app;
};
