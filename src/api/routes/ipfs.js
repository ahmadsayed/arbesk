import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";
import { getStorage } from "../storage/index.js";
import { maybeDecompress, extractIpfsCids } from "../ipfs-utils.js";
import { getSceneNodes } from "../manifest-utils.js";

const Router = express.Router;

async function collectEmbeddedIpfsCids(cid, cids, errors) {
  if (!cid || cids.has(`__json_failed_${cid}`)) return;
  try {
    const raw = await getStorage().catBytes(cid);
    const decompressed = await maybeDecompress(raw);
    const json = JSON.parse(decompressed);
    extractIpfsCids(json, cids);
  } catch (e) {
    // Not a JSON object (e.g., raw buffer/image) - nothing to recurse into.
    errors.push(`read refs from ${cid}: ${e.message}`);
  }
}

export default function ipfsRoutes() {
  const router = Router();

  /**
   * POST /api/v1/ipfs/upload-url
   * Mint a short-lived client upload credential. Session-gated and rate-limited
   * per wallet. In Pinata mode returns a presigned URL; in Kubo mode returns the
   * local API URL. The master Pinata JWT never reaches the client.
   */
  router.post(
    "/upload-url",
    authenticate,
    rateLimit({
      max: Number(process.env.UPLOAD_URL_RATE_LIMIT_MAX || 20),
      windowMs: 60 * 1000,
    }),
    async (req, res) => {
      try {
        const credential = await getStorage().mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential - backend=${credential.backend} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", error.message);
        sendError(res, 500, "UPLOAD_URL_FAILED", error.message);
      }
    },
  );

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
   *
   * Auth: Session token required.
   */
  router.post("/unpin", authenticate, async (req, res) => {
    const startTime = Date.now();
    try {
      const { cid: startCid } = req.body || {};
      if (!startCid || typeof startCid !== "string") {
        console.log(`[UNPIN] rejected - cid required`);
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
          const raw = await getStorage().catBytes(currentCid);
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
          // History entries - each has its own source CID + bundle root
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
        `[UNPIN] done - ${unpinned.length} unpinned, ${errors.length} errors (${elapsed}ms)`,
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

  return router;
}
