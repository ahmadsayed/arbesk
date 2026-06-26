import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import { archiveCommentsForAsset } from "../comments-archive.js";
import { getStorage } from "../storage/index.js";

const Router = express.Router;

/**
 * POST /api/v1/assets/snapshot-comments
 *
 * Snapshots the Nostr comment thread for a published asset to a
 * content-addressed IPFS archive. Called by the browser before it
 * writes a republish manifest, so the archive CID can be embedded
 * in the manifest before it is uploaded. Manifests themselves are
 * written directly to IPFS by the browser.
 *
 * Body: { tokenId, chainId, contractAddress, assetId }
 * Response: { cid, eventCount }
 *
 * Auth: Session token required.
 */
export default function commentsRoutes({ getContractAddress }) {
  const router = Router();

  router.post("/snapshot-comments", authenticate, async (req, res) => {
    try {
      const {
        tokenId,
        chainId,
        contractAddress: reqContract,
        assetId,
      } = req.body || {};
      if (!tokenId) {
        return sendError(res, 400, "MISSING_TOKEN_ID", "tokenId is required");
      }
      if (!assetId) {
        return sendError(res, 400, "MISSING_ASSET_ID", "assetId is required");
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

      const assetTag = `${chainIdNum || 31415822}:${contractAddr.toLowerCase()}:${tokenId}:${assetId}`;

      console.log(`[ARCHIVE] snapshotting comments for ${assetTag}`);
      const { cid: archiveCid, eventCount } = await archiveCommentsForAsset(
        assetTag,
        getStorage(),
      );
      console.log(
        `[ARCHIVE] snapshot complete - ${eventCount} events → ${archiveCid}`,
      );

      res.json({ cid: archiveCid, eventCount });
    } catch (error) {
      console.error("[ARCHIVE] snapshot error:", error.message);
      sendError(res, 500, "ARCHIVE_FAILED", error.message);
    }
  });

  return router;
}
