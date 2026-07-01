import express from "express";
import path from "path";
import http from "http";
import url from "url";
import * as dotenv from "dotenv";
import bodyParser from "body-parser";
import morgan from "morgan";
import helmet from "helmet";

const __dirnameRoot = path.dirname(url.fileURLToPath(import.meta.url));

// Load .env files BEFORE any module that reads process.env (config.js)
dotenv.config({ path: path.resolve(__dirnameRoot, "../.env") });
dotenv.config({ path: path.resolve(__dirnameRoot, "../blockchain/.env") });

// Now safe to import - config.js reads from process.env which is populated
const { default: api } = await import("./api/index.js");
const { createChatProxy } = await import("./api/chat-proxy.js");
const { initIndexers } = await import("./api/token-indexer.js");

export const app = express();
const port = process.env.PORT || 9090;
export const server = http.createServer(app);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* ─── Verbose request logger ─── */
app.use(
  morgan(
    /** @type {(tokens: import('morgan').TokenIndexer<import('http').IncomingMessage, import('http').ServerResponse>, req: import('http').IncomingMessage, res: import('http').ServerResponse) => string} */
    (
      tokens,
      req,
      res,
    ) => {
      const status = Number.parseInt(tokens.status(req, res) || "0", 10);
      const tag =
        status >= 400 ? "[ERR]" : status >= 300 ? "[RDR]" : "[OK]";
      const client =
        req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
      const ms = tokens["response-time"](req, res) || "0";
      return `${tag} ${tokens.method(req, res)} ${tokens.url(req, res)} → ${status} (${ms}ms) | client=${client}`;
    },
    {
      stream: {
        /** @param {string} message */
        write: (message) => {
          console.log(message.trim());
        },
      },
    },
  ),
);

/* ─── Content-Security-Policy (report-only) ───
 * Delivered via HTTP header because <meta> does not support
 * the "Report-Only" suffix. Monitor violations in browser
 * console before promoting to enforcing mode.
 */
const pinataGateway = process.env.PINATA_GATEWAY;
const connectSrc = [
  "'self'",
  "http://127.0.0.1:5001",
  "http://127.0.0.1:8545",
  "http://127.0.0.1:9090",
  "ws://localhost:9090",
  "wss://localhost:9090",
  "https://*.llamarpc.com",
  "https://*.publicnode.com",
  "https://esm.sh",
  // CDP / Base Sepolia
  "https://api.cdp.coinbase.com",
  "https://*.cdp.coinbase.com",
  "https://sepolia.base.org",
];
const imgSrc = ["'self'", "blob:", "data:", "http://127.0.0.1:8080"];
if (pinataGateway) {
  connectSrc.push(`https://${pinataGateway}`);
  imgSrc.push(`https://${pinataGateway}`);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-eval'",
          "'unsafe-inline'",
          "https://cdn.babylonjs.com",
          "https://cdn.jsdelivr.net",
          "https://esm.sh",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc,
        imgSrc,
        fontSrc: ["'self'"],
        mediaSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      reportOnly: true,
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

app.use(
  express.static(__dirname + "/../frontend/dist", {
    /** @param {import('express').Response} res @param {string} filePath */
    setHeaders: (res, filePath) => {
      // Workers and their pool must never be cached: a stale worker script
      // that predates a method registration (e.g. "ping") causes the pool to
      // fall back to the main thread and makes save/publish very slow.
      // Workers, their pool, and the vendored libraries they import must never
      // be cached. A stale module that predates a method registration (e.g.
      // "ping") causes the pool to fall back to the main thread.
      if (
        filePath.includes("/workers/") ||
        filePath.endsWith("gltf-worker-pool.js") ||
        filePath.includes("/vendor/workerpool") ||
        filePath.includes("/vendor/gltf-transform-core") ||
        filePath.includes("/vendor/node-buffer-polyfill")
      ) {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  }),
);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/api", api());

// ─── SPA fallback ───
// Studio and Library are served from a single document (app.html) with a
// client-side router. Serve that shell for the clean-URL routes so deep links
// and history.pushState() paths resolve. Kept narrow (explicit paths only) so
// static assets and /api are untouched. Query strings pass through untouched.
app.get(["/studio", "/library"], (_req, res) => {
  res.sendFile(path.join(__dirname, "/../frontend/dist/app.html"));
});

// Attach WebSocket chat proxy to the same HTTP server
createChatProxy(server);

if (process.env.NODE_ENV !== "test") {
  server.listen(port);
  initIndexers().catch((err) => {
    console.error("[API] failed to initialize token indexers:", err);
  });
  console.log("[BOOT] Server started at http://localhost:" + port);
  console.log(
    "[BOOT] IPFS_API_URL=" +
      (process.env.IPFS_API_URL || "http://127.0.0.1:5001"),
  );
  console.log(
    "[BOOT] MOCK_3D_GENERATION=" + (process.env.MOCK_3D_GENERATION || "false"),
  );
}
