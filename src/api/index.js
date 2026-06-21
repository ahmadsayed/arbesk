import express from "express";
import path from "path";
import url from "url";
import fs from "fs";

const Router = express.Router;
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Dynamic import to ensure process.env is populated before config.js reads it.
// api/index.js is loaded via dynamic import() from index.js after dotenv runs.
const {
  CONTRACT_ADDRESS,
  ASSETS_IPFS,
  HARDHAT_RPC_URL,
  NETWORK_CONFIGS,
  getContractAddress,
  getWeb3,
  web3,
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
 * Add a payload to the configured storage backend (adds + pins).
 * Returns the CID string.
 */
async function addAndPin(payload) {
  return getStorage().add(payload);
}

// ─── Thumbnail Helpers ──────────────────────────────────────────────────────

const THUMBNAIL_DATA_URL_RE =
  /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/;
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

function thumbnailExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  return mime.split("/")[1] || "webp";
}

async function persistEmbeddedThumbnail(manifest) {
  const thumbnail = manifest?.thumbnail;
  if (!thumbnail || typeof thumbnail !== "object" || !thumbnail.dataUrl) {
    return manifest;
  }

  const previousThumbnailCid = thumbnail.cid;
  try {
    const match = String(thumbnail.dataUrl).match(THUMBNAIL_DATA_URL_RE);
    if (!match) {
      throw new Error("unsupported thumbnail data URL");
    }

    const mime = match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length) {
      throw new Error("empty thumbnail payload");
    }
    if (buffer.length > THUMBNAIL_MAX_BYTES) {
      throw new Error(`thumbnail too large (${buffer.length} bytes)`);
    }

    console.log(
      `[IPFS] add thumbnail | size=${buffer.length} bytes mime=${mime}`,
    );
    const thumbnailCid = await getStorage().add(buffer);
    const format = thumbnailExtension(mime);
    manifest.thumbnail = {
      type: "snapshot",
      cid: thumbnailCid,
      path: thumbnail.path || `thumbnail.${format}`,
      format,
      mime,
      width: Number.isFinite(Number(thumbnail.width))
        ? Number(thumbnail.width)
        : null,
      height: Number.isFinite(Number(thumbnail.height))
        ? Number(thumbnail.height)
        : null,
      bytes: buffer.length,
      timestamp: thumbnail.timestamp || Date.now(),
    };
    console.log(`[IPFS] add thumbnail → ${thumbnailCid}`);
  } catch (error) {
    console.warn(`[IPFS] thumbnail skipped — ${error.message}`);
    if (previousThumbnailCid) {
      manifest.thumbnail = {
        ...thumbnail,
        cid: previousThumbnailCid,
      };
      delete manifest.thumbnail.dataUrl;
    } else {
      delete manifest.thumbnail;
    }
  }

  return manifest;
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

  v1.use("/generations", generateAssetNode(getStorage()));

  // ─── Manifests ────────────────────────────────────────────────────────────

  // Create a new manifest (was save-draft)
  v1.post("/manifests", async (req, res) => {
    try {
      let manifest = req.body;
      if (!manifest || typeof manifest !== "object") {
        console.log(`[SAVE] rejected — manifest object required`);
        return sendError(
          res,
          400,
          "INVALID_MANIFEST",
          "Manifest object required",
        );
      }

      // Extract optional publish context used to snapshot comments on republish.
      // This is removed from the stored manifest; it is only a control signal.
      const publishContext = manifest.publishContext || null;
      delete manifest.publishContext;

      // Collection-type manifests use a flat `assets` map instead of
      // `scene.nodes` — skip the scene/nodes default and validate `assets`.
      const isCollection = manifest.type === "collection";
      if (isCollection) {
        if (
          !manifest.assets ||
          typeof manifest.assets !== "object" ||
          Array.isArray(manifest.assets)
        ) {
          console.log(
            `[SAVE] rejected — collection manifest requires an assets object`,
          );
          return sendError(
            res,
            400,
            "INVALID_COLLECTION_ASSETS",
            "Collection manifest requires an `assets` object",
          );
        }
      }

      // Ensure version fields are present
      if (!manifest.asset_id) {
        manifest.asset_id = `asset_${Date.now()}`;
      }
      if (!isCollection) {
        getSceneNodes(manifest); // ensure .scene and .nodes exist (assets only)
      }
      if (typeof manifest.version !== "number") {
        manifest.version = 1;
      }

      await persistEmbeddedThumbnail(manifest);

      // On republish, snapshot the asset's Nostr comment thread to IPFS and
      // embed the archive CID in the manifest. Failures are logged but never
      // block the publish.
      if (publishContext?.tokenId) {
        const chainId = publishContext.chainId
          ? Number(publishContext.chainId)
          : null;
        const contractAddress =
          publishContext.contractAddress || getContractAddress(chainId);
        if (contractAddress) {
          const tokenIdNum = Number(publishContext.tokenId);
          const assetId = `${chainId || 31415822}:${contractAddress}:${tokenIdNum}`;
          try {
            const { cid: archiveCid } = await archiveCommentsForAsset(
              assetId,
              getStorage(),
            );
            manifest.comments_archive_cid = archiveCid;
          } catch (archiveErr) {
            console.warn(
              `[ARCHIVE] failed to snapshot comments for ${assetId}: ${archiveErr.message}`,
            );
          }
        }
      }

      const resultCid = await addAndPin(JSON.stringify(manifest));
      console.log(
        `[SAVE] asset_id=${manifest.asset_id} type=${manifest.type || "asset"} version=${manifest.version} ${isCollection ? `assets=${Object.keys(manifest.assets).length}` : `nodes=${manifest.scene.nodes.length}`} prev=${manifest.prev_asset_manifest_cid || "null"} thumbnail=${manifest.thumbnail?.cid || "none"} comments_archive=${manifest.comments_archive_cid || "none"} → cid=${resultCid}`,
      );

      res.status(201).json({
        cid: resultCid,
        assetId: manifest.asset_id,
        version: manifest.version,
      });
    } catch (error) {
      console.error("[SAVE] error:", error.message);
      sendError(res, 500, "SAVE_FAILED", error.message);
    }
  });

  // Publish a manifest (with thumbnail support)
  v1.post("/manifests/:cid/publish", async (req, res) => {
    try {
      const manifest = req.body;
      await persistEmbeddedThumbnail(manifest);

      const payload = JSON.stringify(manifest);
      console.log(
        `[IPFS] publish | payload=${payload.length} chars thumbnail=${manifest?.thumbnail?.cid || "none"}`,
      );
      const resultCid = await addAndPin(payload);
      console.log(`[IPFS] publish → ${resultCid}`);

      res.status(200).json({ cid: resultCid });
    } catch (error) {
      console.error("[IPFS] publish error:", error.message);
      sendError(res, 500, "PUBLISH_FAILED", error.message);
    }
  });

  // Walk manifest version chain
  v1.get("/manifests/:cid/history", async (req, res) => {
    try {
      const { cid } = req.params;
      if (!cid) {
        console.log(`[CHAIN] rejected — cid param required`);
        return sendError(
          res,
          400,
          "MISSING_CID",
          "CID path parameter is required",
        );
      }

      console.log(`[CHAIN] walking from ${cid}`);
      const chain = [];
      const visited = new Set();
      let currentCid = cid;
      const MAX_DEPTH = 50;

      while (currentCid && chain.length < MAX_DEPTH) {
        if (visited.has(currentCid)) {
          console.log(
            `[CHAIN] circular link detected at ${currentCid}, stopping`,
          );
          break;
        }
        visited.add(currentCid);

        try {
          const raw = await getStorage().cat(currentCid);
          const manifest = JSON.parse(raw);
          const nodes = getSceneNodes(manifest);
          const timestamp = manifest.timestamp || null;

          chain.unshift({
            cid: currentCid,
            version: manifest.version || 1,
            name: manifest.name || null,
            nodeCount: nodes.length,
            timestamp,
          });

          currentCid = manifest.prev_asset_manifest_cid || null;
        } catch (e) {
          console.warn(`[CHAIN] walk failed at ${currentCid}: ${e.message}`);
          break;
        }
      }

      console.log(
        `[CHAIN] returned ${chain.length} entries (depth ${visited.size})`,
      );
      res.json({ chain });
    } catch (error) {
      console.error("[CHAIN] error:", error.message);
      sendError(res, 500, "CHAIN_WALK_FAILED", error.message);
    }
  });

  // ─── Tokens ───────────────────────────────────────────────────────────────

  // Resolve a token ID to its manifest
  v1.get("/tokens/:tokenId/manifest", async (req, res) => {
    try {
      const { tokenId } = req.params;
      const chainId = req.query.chainId;
      if (!tokenId) {
        console.log(`[TOKEN] rejected — tokenId required`);
        return sendError(res, 400, "MISSING_TOKEN_ID", "tokenId is required");
      }

      const contractAddr = getContractAddress(chainId);
      if (!contractAddr) {
        console.log(
          `[TOKEN] rejected — CONTRACT_ADDRESS not configured for chain ${chainId || "default"}`,
        );
        return sendError(
          res,
          503,
          "CONTRACT_NOT_CONFIGURED",
          "Contract address not configured",
        );
      }

      // Load ABI
      let abi;
      try {
        const abiPath = path.resolve(
          __dirname,
          "../../blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json",
        );
        const abiRaw = fs.readFileSync(abiPath, "utf-8");
        abi = JSON.parse(abiRaw).abi;
      } catch (e) {
        console.log(`[TOKEN] ABI not found — compile contracts first`);
        return sendError(
          res,
          503,
          "ABI_NOT_FOUND",
          "Contract ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile",
        );
      }

      const w3 = chainId ? getWeb3(chainId) : web3;
      const contract = new w3.eth.Contract(abi, contractAddr);
      const manifestCid = await contract.methods.tokenURI(tokenId).call();
      if (!manifestCid) {
        console.log(`[TOKEN] no manifest URI for token ${tokenId}`);
        return sendError(
          res,
          404,
          "TOKEN_NOT_FOUND",
          "Token not found or has no manifest URI",
        );
      }

      console.log(`[TOKEN] token ${tokenId} → CID ${manifestCid}`);
      const raw = await getStorage().cat(manifestCid);
      const manifest = JSON.parse(raw);

      res.json({ tokenId, manifestCid, manifest });
    } catch (error) {
      console.error("[TOKEN] error:", error.message);
      sendError(res, 500, "TOKEN_RESOLUTION_FAILED", error.message);
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

  /**
   * POST /api/v1/ipfs/unpin
   *
   * Unpin all IPFS CIDs owned by a manifest chain. Called after token burn.
   * Walks prev_asset_manifest_cid backward, collecting manifest CIDs,
   * source asset CIDs (from every history entry), and thumbnail CIDs,
   * then unpins them all so they become eligible for garbage collection.
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
          manifest = JSON.parse(raw);
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
          // Current source CID
          if (node?.source?.cid && typeof node.source.cid === "string") {
            toUnpin.add(node.source.cid);
          }
          // History entries — each has its own source CID
          if (Array.isArray(node?.history)) {
            for (const entry of node.history) {
              if (entry?.src?.cid && typeof entry.src.cid === "string") {
                toUnpin.add(entry.src.cid);
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
  api._getFromIPFS = async (cid) => getStorage().cat(cid);

  return api;
};
