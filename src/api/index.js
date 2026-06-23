import express from "express";
import zlib from "zlib";

const Router = express.Router;

// Dynamic import to ensure process.env is populated before config.js reads it.
// api/index.js is loaded via dynamic import() from index.js after dotenv runs.
const {
  CONTRACT_ADDRESS,
  ASSETS_IPFS,
  HARDHAT_RPC_URL,
  NETWORK_CONFIGS,
  getContractAddress,
} = await import("../config.js");

import generateAssetNode from "./assets/generate-node.js";
import abiRouter from "./abi-router.js";
import rateLimit, { _resetRateLimiter } from "./rate-limiter.js";
import authenticate from "./authentication.js";
import { getStorage } from "./storage/index.js";
import sessionRouter from "./sessions.js";
import openapiSpec from "./openapi.json" with { type: "json" };
import { getSceneNodes } from "./manifest-utils.js";
import { archiveCommentsForAsset } from "./comments-archive.js";

// ─── Middleware & Helpers ────────────────────────────────────────────────────

/**
 * Reject requests that are not application/json.
 */
function requireJson(req, res, next) {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    !req.is("application/json")
  ) {
    return res.status(415).json({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
      },
    });
  }
  next();
}

/**
 * Standardized error response helper.
 */
function sendError(res, status, code, message, details = null) {
  const body = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

/**
 * Decompress gzipped data if needed, otherwise return as-is.
 * @param {string} data - The raw data from IPFS (might be gzipped)
 * @returns {Promise<string>} Decompressed string if gzipped, original string otherwise
 */
async function maybeDecompress(data) {
  // Check if data starts with gzip magic number (0x1f 0x8b)
  if (
    data &&
    data.length > 2 &&
    data.charCodeAt(0) === 0x1f &&
    data.charCodeAt(1) === 0x8b
  ) {
    try {
      const buffer = Buffer.from(data, "utf-8");
      const decompressed = zlib.gunzipSync(buffer);
      return decompressed.toString("utf-8");
    } catch (e) {
      console.warn("[DECOMPRESS] failed to decompress data:", e.message);
      // If decompression fails, return original data
      return data;
    }
  }
  return data;
}

// ─── Router ─────────────────────────────────────────────────────────────────

export default () => {
  const v1 = Router();

  // Apply JSON validation to all mutating routes
  v1.use(requireJson);

  // ─── Config ───────────────────────────────────────────────────────────────

  v1.get("/config", (req, res) => {
    const storage = getStorage();
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      networkConfigs: NETWORK_CONFIGS,
      ipfsBackend: storage.backend,
      ipfsGatewayUrl: storage.gatewayBase(),
      hardhatRpcUrl: HARDHAT_RPC_URL,
      mockGeneration: process.env.MOCK_3D_GENERATION === "true",
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null,
    });
  });

  // ─── Sessions ────────────────────────────────────────────────────────────

  v1.use("/sessions", sessionRouter());

  // ─── Generations ──────────────────────────────────────────────────────────

  v1.use("/generations", generateAssetNode());

  // ─── Comments Archive ─────────────────────────────────────────────────────

  /**
   * POST /api/v1/assets/snapshot-comments
   *
   * Snapshots the Nostr comment thread for a published asset to a
   * content-addressed IPFS archive. Called by the browser before it
   * writes a republish manifest, so the archive CID can be embedded
   * in the manifest before it is uploaded. Manifests themselves are
   * written directly to IPFS by the browser.
   *
   * Body: { tokenId, chainId, contractAddress }
   * Response: { cid, eventCount }
   */
  v1.post("/assets/snapshot-comments", async (req, res) => {
    try {
      const { tokenId, chainId, contractAddress: reqContract } = req.body || {};
      if (!tokenId) {
        return sendError(res, 400, "MISSING_TOKEN_ID", "tokenId is required");
      }

      const chainIdNum = chainId ? Number(chainId) : null;
      const contractAddr = reqContract || getContractAddress(chainIdNum);
      if (!contractAddr) {
        return sendError(
          res,
          503,
          "CONTRACT_NOT_CONFIGURED",
          "Contract address not configured",
        );
      }

      const tokenIdNum = Number(tokenId);
      const assetId = `${chainIdNum || 31415822}:${contractAddr}:${tokenIdNum}`;

      console.log(`[ARCHIVE] snapshotting comments for ${assetId}`);
      const { cid: archiveCid, eventCount } = await archiveCommentsForAsset(
        assetId,
        getStorage(),
      );
      console.log(
        `[ARCHIVE] snapshot complete — ${eventCount} events → ${archiveCid}`,
      );

      res.json({ cid: archiveCid, eventCount });
    } catch (error) {
      console.error("[ARCHIVE] snapshot error:", error.message);
      sendError(res, 500, "ARCHIVE_FAILED", error.message);
    }
  });

  // ─── IPFS Upload Credential ────────────────────────────────────────────────

  /**
   * POST /api/v1/ipfs/upload-url
   * Mint a short-lived client upload credential. Session-gated and rate-limited
   * per wallet. In Pinata mode returns a presigned URL; in Kubo mode returns the
   * local API URL. The master Pinata JWT never reaches the client.
   */
  v1.post(
    "/ipfs/upload-url",
    authenticate,
    rateLimit({
      max: Number(process.env.UPLOAD_URL_RATE_LIMIT_MAX || 20),
      windowMs: 60 * 1000,
    }),
    async (req, res) => {
      try {
        const credential = await getStorage().mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential — backend=${credential.backend} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", error.message);
        sendError(res, 500, "UPLOAD_URL_FAILED", error.message);
      }
    },
  );

  // ─── IPFS Unpin ──────────────────────────────────────────────────────────

  const IPFS_URI_RE = /ipfs:\/\/([a-zA-Z0-9]+)/g;

  function extractIpfsCids(value, cids) {
    if (typeof value === "string") {
      for (const match of value.matchAll(IPFS_URI_RE)) {
        cids.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) extractIpfsCids(item, cids);
    } else if (value && typeof value === "object") {
      for (const v of Object.values(value)) extractIpfsCids(v, cids);
    }
  }

  async function collectEmbeddedIpfsCids(cid, cids, errors) {
    if (!cid || cids.has(`__json_failed_${cid}`)) return;
    try {
      const raw = await getStorage().cat(cid);
      const decompressed = await maybeDecompress(raw);
      const json = JSON.parse(decompressed);
      extractIpfsCids(json, cids);
    } catch (e) {
      // Not a JSON object (e.g., raw buffer/image) — nothing to recurse into.
      errors.push(`read refs from ${cid}: ${e.message}`);
    }
  }

  /**
   * POST /api/v1/ipfs/unpin
   *
   * Unpin all IPFS CIDs owned by a manifest chain. Called after token burn
   * or asset removal from a collection.
   * Walks prev_asset_manifest_cid backward, collecting manifest CIDs,
   * source asset CIDs (and the buffers/images referenced inside them),
   * thumbnail CIDs, and comments archive CIDs, then unpins them all so
   * they become eligible for garbage collection.
   *
   * Body: { cid: "baf..." }
   */
  v1.post("/ipfs/unpin", async (req, res) => {
    const startTime = Date.now();
    try {
      const { cid: startCid } = req.body || {};
      if (!startCid || typeof startCid !== "string") {
        console.log(`[UNPIN] rejected — cid required`);
        return sendError(res, 400, "MISSING_CID", "CID is required in body");
      }

      console.log(`[UNPIN] starting from ${startCid}`);

      const toUnpin = new Set();
      const visited = new Set();
      const errors = [];
      let currentCid = startCid;
      const MAX_DEPTH = 100;

      // Walk the manifest chain and collect all owned CIDs
      while (currentCid && visited.size < MAX_DEPTH) {
        if (visited.has(currentCid)) {
          console.log(`[UNPIN] circular link at ${currentCid}, stopping`);
          break;
        }
        visited.add(currentCid);

        let manifest;
        try {
          const raw = await getStorage().cat(currentCid);
          const decompressed = await maybeDecompress(raw);
          manifest = JSON.parse(decompressed);
        } catch (e) {
          console.warn(`[UNPIN] cannot read ${currentCid}: ${e.message}`);
          errors.push(`read ${currentCid}: ${e.message}`);
          break;
        }

        // Collect this manifest CID
        toUnpin.add(currentCid);

        // Collect thumbnail CID
        const thumbnailCid = manifest?.thumbnail?.cid;
        if (thumbnailCid && typeof thumbnailCid === "string") {
          toUnpin.add(thumbnailCid);
        }

        // Collect comments archive CID
        const commentsArchiveCid = manifest?.comments_archive_cid;
        if (commentsArchiveCid && typeof commentsArchiveCid === "string") {
          toUnpin.add(commentsArchiveCid);
        }

        // Collect source asset CIDs from nodes (current sources + history)
        const nodes = getSceneNodes(manifest);
        for (const node of nodes) {
          // Current source CID + organizational bundle directory root
          if (node?.source?.cid && typeof node.source.cid === "string") {
            toUnpin.add(node.source.cid);
            await collectEmbeddedIpfsCids(node.source.cid, toUnpin, errors);
          }
          if (
            node?.source?.bundleCid &&
            typeof node.source.bundleCid === "string"
          ) {
            toUnpin.add(node.source.bundleCid);
          }
          // History entries — each has its own source CID + bundle root
          if (Array.isArray(node?.history)) {
            for (const entry of node.history) {
              if (entry?.src?.cid && typeof entry.src.cid === "string") {
                toUnpin.add(entry.src.cid);
                await collectEmbeddedIpfsCids(entry.src.cid, toUnpin, errors);
              }
              if (
                entry?.src?.bundleCid &&
                typeof entry.src.bundleCid === "string"
              ) {
                toUnpin.add(entry.src.bundleCid);
              }
            }
          }
        }

        // Follow the chain backward
        currentCid = manifest.prev_asset_manifest_cid || null;
      }

      console.log(
        `[UNPIN] collected ${toUnpin.size} CIDs across ${visited.size} manifest(s)`,
      );

      // Unpin each collected CID
      const unpinned = [];
      for (const cid of toUnpin) {
        try {
          // The adapter treats "already unpinned" as success.
          await getStorage().unpin(cid);
          unpinned.push(cid);
          console.log(`[UNPIN] unpinned → ${cid}`);
        } catch (e) {
          console.warn(`[UNPIN] failed to unpin ${cid}: ${e.message}`);
          errors.push(`unpin ${cid}: ${e.message}`);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `[UNPIN] done — ${unpinned.length} unpinned, ${errors.length} errors (${elapsed}ms)`,
      );

      res.json({
        unpinned,
        count: unpinned.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("[UNPIN] error:", error.message);
      sendError(res, 500, "UNPIN_FAILED", error.message);
    }
  });

  // ─── Contracts ────────────────────────────────────────────────────────────

  // Serve contract ABI by name
  v1.get("/contracts/:name/abi", (req, res) => {
    const abiRouterInstance = abiRouter();
    // Forward to the existing ABI router logic
    req.url = `/${req.params.name}.json`;
    abiRouterInstance(req, res);
  });

  // ─── OpenAPI Specification ─────────────────────────────────────────────────

  v1.get("/openapi.json", (req, res) => {
    res.json(openapiSpec);
  });

  // ─── Test-only utilities ───────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    v1.post("/test/reset-rate-limit", (req, res) => {
      _resetRateLimiter();
      console.log("[RATE-LIMIT] reset via test endpoint");
      res.json({ ok: true });
    });
  }

  // ─── Mount under /api/v1 ──────────────────────────────────────────────────

  const api = Router();

  // ─── Swagger UI ────────────────────────────────────────────────────────────

  api.get("/docs", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arbesk API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout",
      deepLinking: true
    });
  </script>
</body>
</html>`);
  });

  api.use("/v1", v1);

  // Expose for test helpers
  api._getFromIPFS = async (cid) => {
    const raw = await getStorage().cat(cid);
    return maybeDecompress(raw);
  };

  return api;
};
