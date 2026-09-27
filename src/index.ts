import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { createAdaptorServer } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "path";
import type { Server } from "http";
import { PROJECT_ROOT } from "./api/project-root.ts";
import { requestLog } from "./api/request-log.ts";
import { secureHeaders } from "./api/secure-headers.ts";
import { sendError } from "./api/errors.ts";

// Load .env files BEFORE any module that reads process.env (config.ts).
// process.loadEnvFile is the Node 20.12+ built-in (also supported by Bun);
// missing files are fine — Bun also auto-loads the root .env, which is
// idempotent with the explicit load here.
try {
  process.loadEnvFile(path.resolve(PROJECT_ROOT, ".env"));
} catch {
  // missing .env is fine — Bun also auto-loads the root .env
}
try {
  process.loadEnvFile(path.resolve(PROJECT_ROOT, "blockchain/.env"));
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

// strict: false — "/path" and "/path/" match the same route, as they did
// under Express.
export const app = new Hono({ strict: false });
const port = Number(process.env.PORT || 9090);
// A plain node:http server (Node and Bun alike), so the WebSocket chat proxy
// can attach to its upgrade event.
export const server = createAdaptorServer({ fetch: app.fetch }) as Server;
const staticRoot = path.resolve(PROJECT_ROOT, "frontend/dist");

/** Largest request body the API accepts (generation uploads carry base64 images). */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

/* ─── Request log: [OK]/[ERR]/[RDR] METHOD url → status (ms) | client=… ─── */
app.use(requestLog());

/* ─── Response compression ───
 * gzip/deflate negotiated by Accept-Encoding. The bundled frontend
 * (dist/js/app.js) is ~2.4 MB minified; compression shrinks it to ~780 KB
 * on the wire. Responses already carrying Content-Encoding (the precompressed
 * brotli assets below) pass through untouched.
 */
app.use(compress());

/* ─── Security headers (report-only CSP, COOP, nosniff, HSTS, …) ─── */
app.use(secureHeaders());

/* ─── API ─── */
app.use(
  "/api/*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      sendError(c, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds 50 MB"),
  }),
);
app.route("/api", api({ storage, core }));

// Workers, their pool, and the vendored libraries they import must never be
// cached. A stale module that predates a method registration (e.g. "ping")
// causes the pool to fall back to the main thread and makes save/publish very
// slow.
function setStaticCacheHeaders(c: Context, filePath: string): void {
  if (
    filePath.includes("/workers/") ||
    filePath.includes("gltf-worker-pool.js") ||
    filePath.includes("/vendor/workerpool") ||
    filePath.includes("/vendor/gltf-transform-core") ||
    filePath.includes("/vendor/node-buffer-polyfill")
  ) {
    c.header(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
  }
}

/* ─── Static frontend ───
 * precompressed: frontend/scripts/compress.js emits .br siblings at build
 * time; clients that accept brotli get those, the rest fall through to
 * on-the-fly gzip.
 */
app.use(
  "*",
  serveStatic({
    root: staticRoot,
    precompressed: true,
    onFound: (filePath, c) => setStaticCacheHeaders(c, filePath),
  }),
);

// ─── SPA fallback ───
// Studio and Library are served from a single document (app.html) with a
// client-side router. Serve that shell for the clean-URL routes so deep links
// and history.pushState() paths resolve — including public profile paths
// (/library/<base58>, /studio/<base58>). Kept narrow so static assets and
// /api are untouched. Query strings pass through untouched.
const spaShell = serveStatic({
  root: staticRoot,
  path: "app.html",
  precompressed: true,
});
for (const section of ["studio", "library"]) {
  app.get(`/${section}`, spaShell);
  app.get(`/${section}/*`, spaShell);
}

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
