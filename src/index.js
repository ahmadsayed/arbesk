import express from "express";
import path from "path";
import http from "http";
import url from "url";
import * as dotenv from "dotenv";
import api from "./api/index.js";
import bodyParser from "body-parser";
import { loadLedger } from "./ledger/store.js";

const __dirnameRoot = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirnameRoot, "../.env") });

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

app.use(express.static(__dirname + "/../frontend/dist"));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use("/api", api());

if (process.env.NODE_ENV !== "test") {
  // Initialize the micro-ledger (loads from disk)
  const ledgerCount = loadLedger();
  console.log(`[BOOT] micro-ledger ready — ${ledgerCount} entries`);

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
