import { Hono } from "hono";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import type { AuthEnv } from "../authentication.ts";
import { archiveCommentsForAsset } from "../comments-archive.ts";
import type { StorageAdapter } from "../storage/index.ts";
import { validateBody } from "../validation.ts";
import { snapshotCommentsSchema } from "../schemas.ts";
import { buildAssetTag } from "../asset-tag.ts";

/**
 * POST /api/v1/assets/snapshot-comments
 *
 * Snapshots the Nostr comment thread for a published asset to a
 * content-addressed IPFS archive.
 * @remarks Called before the browser writes a republish manifest, so the
 *   archive CID can be embedded in the manifest before it is uploaded.
 *
 * Body: { tokenId, chainId, contractAddress, assetId }
 * Response: { cid, eventCount }
 *
 * Auth: Session token required.
 */
export default function commentsRoutes({
  getContractAddress,
  storage,
}: {
  getContractAddress: (chainId: number | null) => string | null;
  storage: StorageAdapter;
}) {
  const app = new Hono<AuthEnv>();

  app.post(
    "/snapshot-comments",
    authenticate,
    validateBody(snapshotCommentsSchema),
    async (c) => {
      try {
        const {
          tokenId,
          chainId,
          contractAddress: reqContract,
          assetId,
        } = c.req.valid("json");

        const chainIdNum = chainId ?? null;
        const contractAddr = reqContract || getContractAddress(chainIdNum);
        if (!contractAddr) {
          return sendError(
            c,
            503,
            "CONTRACT_NOT_CONFIGURED",
            "Contract address not configured",
          );
        }

        const assetTag = buildAssetTag(chainIdNum, contractAddr, tokenId, assetId);

        console.log(`[ARCHIVE] snapshotting comments for ${assetTag}`);
        const { cid: archiveCid, eventCount } = await archiveCommentsForAsset(
          assetTag,
          storage,
        );
        console.log(
          `[ARCHIVE] snapshot complete - ${eventCount} events → ${archiveCid}`,
        );

        return c.json({ cid: archiveCid, eventCount });
      } catch (error) {
        const err = error as Error;
        console.error("[ARCHIVE] snapshot error:", err.message);
        return sendError(c, 500, "ARCHIVE_FAILED", err.message);
      }
    },
  );

  return app;
}
