import { Router } from "express";
import path from "path";
import url from "url";
import fs from "fs";
import { create } from "ipfs-http-client";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Dynamic import to ensure process.env is populated before config.js reads it.
// api/index.js is loaded via dynamic import() from index.js after dotenv runs.
const { CONTRACT_ADDRESS, ASSETS_IPFS, IPFS_API_URL, HARDHAT_RPC_URL, web3 } =
  await import("../config.js");

import generateAssetNode from "./assets/generate-node.js";
import parametricVersion from "./assets/save-variant.js";
import abiRouter from "./abi-router.js";
import rateLimit from "./rate-limiter.js";
import ledgerRouter from "./ledger.js";
import { createLedgerEntry } from "../ledger/schema.js";
import { appendEntry } from "../ledger/store.js";
import { getSceneNodes } from "./manifest-utils.js";
import { catManifest } from "./ipfs-utils.js";

const ipfs = create(new URL(IPFS_API_URL));

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
    const { cid } = await ipfs.add(buffer);
    const thumbnailCid = cid.toString();
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

export default () => {
  let api = Router();

  api.get("/contract_address", (req, res) => {
    res.json({ contract_address: CONTRACT_ADDRESS });
  });

  api.post("/assets/publish-manifest", async (req, res) => {
    try {
      const manifest = req.body;
      await persistEmbeddedThumbnail(manifest);

      const payload = JSON.stringify(manifest);
      console.log(
        `[IPFS] add /assets/publish-manifest | payload=${payload.length} chars thumbnail=${manifest?.thumbnail?.cid || "none"}`,
      );
      const { cid } = await ipfs.add(payload);
      const resultCid = cid.toString();
      console.log(`[IPFS] add /assets/publish-manifest | cid=${resultCid}`);

      // Record to micro-ledger
      const hasThumbnail = !!manifest?.thumbnail?.cid;
      appendEntry(
        createLedgerEntry({
          opType: "PUBLISH",
          manifestId: manifest.asset_id || manifest.name || "unknown",
          cid: resultCid,
          prevCid: manifest.prev_asset_manifest_cid || null,
          actorAddress: req.body.actorAddress || "system",
          payload: {
            publishedCid: resultCid,
            thumbnailCid: manifest?.thumbnail?.cid || null,
            thumbnailMime: manifest?.thumbnail?.mime || null,
            thumbnailBytes: manifest?.thumbnail?.bytes || null,
          },
        }),
      );

      res.send(resultCid);
    } catch (error) {
      console.error("[IPFS] /assets/publish-manifest error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Save a manifest to IPFS without any blockchain interaction.
   * Handles version chaining automatically.
   */
  api.post("/assets/save-draft", async (req, res) => {
    try {
      const manifest = req.body;
      if (!manifest || typeof manifest !== "object") {
        console.log(`[SAVE] rejected — manifest object required`);
        return res.status(400).json({ error: "Manifest object required" });
      }

      // Ensure version fields are present
      if (!manifest.asset_id) {
        manifest.asset_id = `asset_${Date.now()}`;
      }
      getSceneNodes(manifest); // ensure .scene and .nodes exist
      if (typeof manifest.version !== "number") {
        manifest.version = 1;
      }

      await persistEmbeddedThumbnail(manifest);

      const { cid } = await ipfs.add(JSON.stringify(manifest));
      const resultCid = cid.toString();
      console.log(
        `[SAVE] asset_id=${manifest.asset_id} version=${manifest.version} nodes=${manifest.scene.nodes.length} prev=${manifest.prev_asset_manifest_cid || "null"} thumbnail=${manifest.thumbnail?.cid || "none"}`,
      );
      console.log(`[SAVE] asset_id=${manifest.asset_id} → cid=${resultCid}`);

      // Record to micro-ledger
      appendEntry(
        createLedgerEntry({
          opType: "SAVE",
          manifestId: manifest.asset_id,
          cid: resultCid,
          prevCid: manifest.prev_asset_manifest_cid || null,
          actorAddress: req.body.actorAddress || "system",
          payload: {
            version: manifest.version,
            nodeCount: manifest.scene.nodes.length,
          },
        }),
      );

      res.json({
        cid: resultCid,
        asset_id: manifest.asset_id,
        version: manifest.version,
      });
    } catch (error) {
      console.error("[SAVE] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Mount ABI router
  api.use("/abi", abiRouter());

  // Mount ledger routes
  api.use("/ledger", ledgerRouter());

  api.use("/assets/generate-node", generateAssetNode(ipfs));

  api.use("/assets/save-variant", parametricVersion(ipfs));

  async function getFromIPFS(cid) {
    return catManifest(ipfs, cid);
  }

  /**
   * Walk the manifest chain backwards via prev_asset_manifest_cid links.
   * Returns lightweight summaries of each version.
   */
  api.get("/assets/history", async (req, res) => {
    try {
      const { cid } = req.query;
      if (!cid) {
        console.log(`[CHAIN] rejected — cid query param required`);
        return res.status(400).json({ error: "cid query param required" });
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
          const raw = await getFromIPFS(currentCid);
          const manifest = JSON.parse(raw);
          const nodes = getSceneNodes(manifest);
          const firstNode = nodes[0];
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
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Fetch a manifest by TokenID.
   * Queries the ArbeskAsset contract for tokenURI, then fetches the manifest from IPFS.
   */
  api.get("/assets/by-token/:tokenId", async (req, res) => {
    try {
      const { tokenId } = req.params;
      if (!tokenId) {
        console.log(`[TOKEN] rejected — tokenId required`);
        return res.status(400).json({ error: "tokenId is required" });
      }

      if (!CONTRACT_ADDRESS) {
        console.log(`[TOKEN] rejected — CONTRACT_ADDRESS not configured`);
        return res
          .status(503)
          .json({ error: "Contract address not configured" });
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
        return res.status(503).json({
          error:
            "Contract ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile",
        });
      }

      const contract = new web3.eth.Contract(abi, CONTRACT_ADDRESS);
      const manifestCid = await contract.methods.tokenURI(tokenId).call();
      if (!manifestCid) {
        console.log(`[TOKEN] no manifest URI for token ${tokenId}`);
        return res
          .status(404)
          .json({ error: "Token not found or has no manifest URI" });
      }

      console.log(`[TOKEN] token ${tokenId} → CID ${manifestCid}`);
      const raw = await getFromIPFS(manifestCid);
      const manifest = JSON.parse(raw);

      res.json({ tokenId, manifestCid, manifest });
    } catch (error) {
      console.error("[TOKEN] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  api.getFromIPFS = getFromIPFS;

  return api;
};
