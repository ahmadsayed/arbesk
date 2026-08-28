/**
 * CLI-auth page (browser-assisted login). Serves a minimal HTML page that runs
 * CDP signInWithEmail (CDP sends the email), verifies the OTP, signs SIWE, and
 * redirects the session token back to the CLI localhost listener.
 */
import express from "express";
import fs from "fs";
import path from "path";
import url from "url";
import type { Request, Response } from "express";

const Router = express.Router;
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.resolve(__dirname, "../cli-auth.html"), "utf8");

export default function cliAuthRoutes() {
  const router = Router();
  router.get("/", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(HTML);
  });
  return router;
}
