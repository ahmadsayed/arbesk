import express from "express";
import type { Response } from "express";
import path from "path";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import url from "url";
import morgan from "morgan";
import type { TokenIndexer } from "morgan";
import helmet from "helmet";
import compression from "compression";

const __dirnameRoot = path.dirname(url.fileURLToPath(import.meta.url));

// Load .env files BEFORE any module that reads process.env (config.ts).
// process.loadEnvFile is the Node 20.12+ built-in (also supported by Bun);
// missing files are fine — Bun also auto-loads the root .env, which is
// idempotent with the explicit load here.
try {
  process.loadEnvFile(path.resolve(__dirnameRoot, "../.env"));
} catch {
  // missing .env is fine — Bun also auto-loads the root .env
}
try {
  process.loadEnvFile(path.resolve(__dirnameRoot, "../blockchain/.env"));
} catch {
  // blockchain/.env is optional outside the contracts workflow
}

// Now safe to import - config.ts reads from process.env which is populated
const { default: api } = await import("./api/index.ts");
const { createChatProxy } = await import("./api/chat-proxy.ts");
const { initIndexers } = await import("./api/token-indexer.ts");
const { createStorageAdapter } = await import("./api/storage/index.ts");
const { createBackendCore } = await import("./api/asset-core-adapters.ts");

// Composition root: build the storage adapter and the asset-core facade once,
// then inject them into the API — no module reaches into a global to obtain
// its storage.
const storage = createStorageAdapter();
const core = createBackendCore(storage);

export const app = express();
const port = process.env.PORT || 9090;
export const server = http.createServer(app);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* ─── Verbose request logger ─── */
app.use(
  morgan(
    (
      tokens: TokenIndexer<IncomingMessage, ServerResponse>,
      req: IncomingMessage,
      res: ServerResponse,
    ): string => {
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
        write: (message: string) => {
          console.log(message.trim());
        },
      },
    },
  ),
);

/* ─── Response compression ───
 * gzip/deflate negotiated by Accept-Encoding. The bundled frontend
 * (dist/js/app.js) is ~2.4 MB minified; compression shrinks it to ~780 KB
 * on the wire. Placed before express.static so static assets are compressed.
 */
app.use(compression());

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
    // Allow the DeepSeek Harness side-viewer to embed the Studio in an iframe
    // on a different origin (localhost:3080). Local dev only — remove this if
    // you disable the side-viewer or harden a public deployment.
    frameguard: false,
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
        // Helmet adds this by default, but browsers ignore it in Report-Only
        // mode and log a console warning on every page load. Re-add it when
        // the policy is promoted to enforcing mode.
        upgradeInsecureRequests: null,
      },
      reportOnly: true,
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

app.use(
  express.static(__dirname + "/../frontend/dist", {
    setHeaders: (res: Response, filePath: string) => {
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/api", api({ storage, core }));

// ─── SPA fallback ───
// Studio and Library are served from a single document (app.html) with a
// client-side router. Serve that shell for the clean-URL routes so deep links
// and history.pushState() paths resolve — including public profile paths
// (/library/<base58>, /studio/<base58>). Kept narrow so static assets and
// /api are untouched. Query strings pass through untouched.
app.get(/^\/(studio|library)(\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(__dirname, "/../frontend/dist/app.html"));
});

// Attach WebSocket chat proxy to the same HTTP server
createChatProxy(server);

if (process.env.NODE_ENV !== "test") {
  server.listen(port);
  initIndexers(storage).catch((err: unknown) => {
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
