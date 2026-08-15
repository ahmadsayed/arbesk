import express from "express";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import { archiveCommentsForAsset } from "../comments-archive.ts";
import { getStorage } from "../storage/index.ts";
import { validateBody } from "../validation.ts";
import { snapshotCommentsSchema } from "../schemas.ts";
import { buildAssetTag } from "../asset-tag.ts";

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
export default function commentsRoutes({
  getContractAddress,
}: {
  getContractAddress: (chainId: number | null) => string | null;
}) {
  const router = Router();

  router.post(
    "/snapshot-comments",
    authenticate,
    validateBody(snapshotCommentsSchema),
    async (req, res) => {
      try {
        const {
          tokenId,
          chainId,
          contractAddress: reqContract,
          assetId,
        } = req.body;

        const chainIdNum = chainId ?? null;
        const contractAddr = reqContract || getContractAddress(chainIdNum);
        if (!contractAddr) {
          return sendError(
            res,
            503,
            "CONTRACT_NOT_CONFIGURED",
            "Contract address not configured",
          );
        }

        const assetTag = buildAssetTag(chainIdNum, contractAddr, tokenId, assetId);

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
        const err = error as Error;
        console.error("[ARCHIVE] snapshot error:", err.message);
        sendError(res, 500, "ARCHIVE_FAILED", err.message);
      }
    },
  );

  return router;
}
