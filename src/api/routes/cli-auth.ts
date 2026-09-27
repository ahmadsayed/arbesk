/**
 * CLI-auth page (browser-assisted login). Serves a minimal HTML page that runs
 * CDP signInWithEmail (CDP sends the email), verifies the OTP, signs SIWE, and
 * redirects the session token back to the CLI localhost listener.
 */
import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "../project-root.ts";

const HTML = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/api/cli-auth.html"),
  "utf8",
);

export default function cliAuthRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.html(HTML));
  return app;
}
