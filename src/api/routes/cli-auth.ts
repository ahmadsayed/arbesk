/**
 * CLI-auth page (browser-assisted login). Serves a minimal HTML page that runs
 * CDP signInWithEmail (CDP sends the email), verifies the OTP, signs SIWE, and
 * redirects the session token back to the CLI localhost listener.
 */
import express from "express";
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";
import { PROJECT_ROOT } from "../project-root.ts";

const Router = express.Router;
const HTML = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/api/cli-auth.html"),
  "utf8",
);

export default function cliAuthRoutes() {
  const router = Router();
  router.get("/", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(HTML);
  });
  return router;
}
