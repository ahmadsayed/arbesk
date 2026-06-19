import express from "express";
import path from "path";
import http from "http";
import url from "url";
import * as dotenv from "dotenv";
import bodyParser from "body-parser";

const __dirnameRoot = path.dirname(url.fileURLToPath(import.meta.url));

// Load .env files BEFORE any module that reads process.env (config.js)
dotenv.config({ path: path.resolve(__dirnameRoot, "../.env") });
dotenv.config({ path: path.resolve(__dirnameRoot, "../blockchain/.env") });

// Now safe to import — config.js reads from process.env which is populated
const { default: api } = await import("./api/index.js");
const { createChatProxy } = await import("./api/chat-proxy.js");

export const app = express();
const port = process.env.PORT || 9090;
export const server = http.createServer(app);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/* ─── Verbose request logger ─── */
function logRequest(req, res, next) {
  const start = Date.now();
  const client =
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  res.on("finish", () => {
    const ms = Date.now() - start;
    const tag =
      res.statusCode >= 400
        ? "[ERR]"
        : res.statusCode >= 300
          ? "[RDR]"
          : "[OK]";
    console.log(
      `${tag} ${req.method} ${req.originalUrl || req.url} → ${res.statusCode} (${ms}ms) | client=${client}`,
    );
  });
  next();
}
app.use(logRequest);

/* ─── Content-Security-Policy (report-only) ───
 * Delivered via HTTP header because <meta> does not support
 * the "Report-Only" suffix. Monitor violations in browser
 * console before promoting to enforcing mode.
 */
function cspMiddleware(req, res, next) {
  const pinataGateway = process.env.PINATA_GATEWAY;
  const pinataConnect = pinataGateway ? ` https://${pinataGateway}` : "";
  res.setHeader(
    "Content-Security-Policy-Report-Only",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.babylonjs.com https://cdn.jsdelivr.net https://esm.sh; " +
      "style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' http://127.0.0.1:5001 http://127.0.0.1:8545 http://127.0.0.1:9090 ws://localhost:9090 wss://localhost:9090 https://*.llamarpc.com https://*.publicnode.com" +
      pinataConnect +
      "; " +
      "img-src 'self' blob: data: http://127.0.0.1:8080" +
      pinataConnect +
      "; " +
      "font-src 'self'; " +
      "media-src 'self'; " +
      "worker-src 'self' blob:; " +
      "frame-src 'none'; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self';",
  );
  next();
}
app.use(cspMiddleware);

app.use(express.static(__dirname + "/../frontend/dist"));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/api", api());

// Attach WebSocket chat proxy to the same HTTP server
createChatProxy(server);

if (process.env.NODE_ENV !== "test") {
  server.listen(port);
  console.log("[BOOT] Server started at http://localhost:" + port);
  console.log(
    "[BOOT] IPFS_API_URL=" +
      (process.env.IPFS_API_URL || "http://127.0.0.1:5001"),
  );
  console.log(
    "[BOOT] MOCK_3D_GENERATION=" + (process.env.MOCK_3D_GENERATION || "false"),
  );
}
