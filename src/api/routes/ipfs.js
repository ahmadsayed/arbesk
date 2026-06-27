import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import {
  uploadUrlRateLimit,
  unpinRateLimit,
  gcRateLimit,
} from "../rate-limiter.js";
import { getStorage } from "../storage/index.js";
import { walkManifestChain } from "../manifest-chain-walker.js";
import { runIpfsGC } from "../ipfs-gc.js";
import { validateBody } from "../validation.js";
import { unpinSchema, gcSchema } from "../schemas.js";

const Router = express.Router;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdminToken(req, res, next) {
  const adminToken = process.env.GC_ADMIN_TOKEN;
  if (!adminToken) {
    return sendError(res, 503, "GC_DISABLED", "GC admin token not configured");
  }
  const provided = req.headers["x-admin-token"];
  if (!provided || provided !== adminToken) {
    return sendError(res, 403, "FORBIDDEN", "Invalid or missing admin token");
  }
  next();
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
    uploadUrlRateLimit,
    async (req, res) => {
      try {
        const credential = await getStorage().mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential - backend=${credential.backend} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", (/** @type {Error} */ (error)).message);
        sendError(res, 500, "UPLOAD_URL_FAILED", (/** @type {Error} */ (error)).message);
      }
    },
  );

  /**
   * POST /api/v1/ipfs/unpin
   *
   * Unpin the asset-unique CIDs owned by a manifest chain. Called after token
   * burn or asset removal from a collection.
   *
   * Because source glTFs, bundle directories, and their embedded buffers/images
   * can be shared across multiple assets via deduplication, this endpoint does
   * NOT unpin them. It only unpins:
   *   - the manifest chain CIDs themselves
   *   - asset manifest thumbnails
   *   - asset manifest comments archives
   *
   * Shared CIDs are reported in `skipped` and reclaimed later by the
   * reachability garbage collector (`POST /api/v1/ipfs/gc`).
   *
   * Body: { cid: "baf..." }
   *
   * Auth: Session token required.
   */
  router.post("/unpin", authenticate, unpinRateLimit, validateBody(unpinSchema), async (req, res) => {
    const startTime = Date.now();
    try {
      const { cid: startCid } = req.body;

      console.log(`[UNPIN] starting from ${startCid}`);

      const { assetUnique, shared, errors } = await walkManifestChain(
        startCid,
        {
          recurseIntoSources: false,
          recurseIntoCollectionAssets: false,
        },
      );

      console.log(
        `[UNPIN] collected ${assetUnique.size} asset-unique + ${shared.size} shared CIDs`,
      );

      // Unpin each asset-unique CID
      const unpinned = [];
      for (const cid of assetUnique) {
        try {
          // The adapter treats "already unpinned" as success.
          await getStorage().unpin(cid);
          unpinned.push(cid);
          console.log(`[UNPIN] unpinned → ${cid}`);
        } catch (e) {
          console.warn(`[UNPIN] failed to unpin ${cid}: ${(/** @type {Error} */ (e)).message}`);
          errors.push(`unpin ${cid}: ${(/** @type {Error} */ (e)).message}`);
        }
      }

      for (const cid of shared) {
        console.log(`[UNPIN] skipped shared CID → ${cid}`);
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `[UNPIN] done - ${unpinned.length} unpinned, ${shared.size} skipped, ${errors.length} errors (${elapsed}ms)`,
      );

      res.json({
        unpinned,
        skipped: Array.from(shared),
        count: unpinned.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("[UNPIN] error:", (/** @type {Error} */ (error)).message);
      sendError(res, 500, "UNPIN_FAILED", (/** @type {Error} */ (error)).message);
    }
  });

  /**
   * POST /api/v1/ipfs/gc
   *
   * Run the reachability garbage collector. Requires session auth plus an
   * admin token in the `X-Admin-Token` header (configured via GC_ADMIN_TOKEN).
   *
   * Body (all optional):
   *   {
   *     "dryRun": true,           // default true
   *     "maxUnpin": 1000,         // default Infinity
   *     "chainId": 31337          // default from env
   *   }
   */
  router.post(
    "/gc",
    authenticate,
    requireAdminToken,
    gcRateLimit,
    validateBody(gcSchema),
    async (req, res) => {
      try {
        const { dryRun, maxUnpin, chainId } = req.body;
        const result = await runIpfsGC({
          dryRun,
          maxUnpin,
          chainId,
        });
        res.json(result);
      } catch (error) {
        console.error("[GC] route error:", (/** @type {Error} */ (error)).message);
        sendError(res, 500, "GC_FAILED", (/** @type {Error} */ (error)).message);
      }
    },
  );

  return router;
}
