import express from "express";
import { getIndexer } from "../token-indexer.ts";
import type { StorageAdapter } from "../storage/index.ts";
import { validateQuery } from "../validation.ts";
import { ownedQuerySchema, sharedQuerySchema } from "../schemas.ts";
import { sendError } from "../errors.ts";

const Router = express.Router;

function ts(): string {
  return new Date().toLocaleTimeString();
}

/**
 * Resolve the indexer for a chain and force a catch-up before returning so
 * freshly minted tokens show up instead of waiting for the next background
 * poll. The catch-up is skipped if one already ran recently to keep the API
 * fast; the background poll runs every 15s, so new tokens appear within that
 * window even when skipped. A `force=true` query parameter bypasses the
 * throttle so the frontend can request an immediate catch-up right after
 * publishing.
 */
async function withFreshIndexer(
  chainId: number,
  force: boolean,
  storage: StorageAdapter,
): Promise<ReturnType<typeof getIndexer>> {
  const indexer = getIndexer(chainId, storage);
  const catchUpStart = Date.now();
  const msSinceCatchUp = Date.now() - indexer.lastCatchUpAt;
  if (force || msSinceCatchUp > 30000) {
    try {
      await indexer.catchUp();
    } catch (catchUpErr) {
      console.warn(
        `[${ts()}] [INDEXER-API] catchUp failed for chain`,
        chainId,
        String((catchUpErr as Error).message)
      );
    }
    console.log(
      `[${ts()}] [INDEXER-API] catchUp for chain ${chainId} took ` +
        `${Date.now() - catchUpStart}ms, lastScannedBlock=${indexer.lastScannedBlock}` +
        (force ? " (forced)" : "")
    );
  } else {
    console.log(
      `[${ts()}] [INDEXER-API] skipped catchUp for chain ${chainId} ` +
        `(${msSinceCatchUp}ms since last)`
    );
  }
  return indexer;
}

/**
 * Indexer API routes.
 *
 * GET /api/v1/indexer/owned?address=0x...&chainId=10143
 * Returns the token IDs owned by the given address on the given chain.
 *
 * GET /api/v1/indexer/shared?address=0x...&chainId=10143
 * Returns token IDs where the address is an editor but not the current owner.
 */
export default function indexerRoutes(storage: StorageAdapter) {
  const router = Router();

  router.get("/owned", validateQuery(ownedQuerySchema), async (req, res) => {
    const { address, chainId, force } = req.query as unknown as {
      address: string;
      chainId: number;
      force: boolean;
    };

    try {
      const indexer = await withFreshIndexer(chainId, force, storage);
      res.json({
        chainId,
        address: address.toLowerCase(),
        owned: indexer.getOwnedTokens(address),
        lastScannedBlock: indexer.lastScannedBlock,
      });
    } catch (err) {
      console.error(`[${ts()}] [INDEXER-API] failed to get owned tokens:`, String((err as Error).message));
      sendError(res, 500, "INDEXER_READ_FAILED", "failed to read indexer state");
    }
  });

  router.get("/shared", validateQuery(sharedQuerySchema), async (req, res) => {
    const { address, chainId, force } = req.query as unknown as {
      address: string;
      chainId: number;
      force: boolean;
    };

    try {
      const indexer = await withFreshIndexer(chainId, force, storage);
      res.json({
        chainId,
        address: address.toLowerCase(),
        shared: indexer.getSharedTokens(address),
        lastScannedBlock: indexer.lastScannedBlock,
      });
    } catch (err) {
      console.error(`[${ts()}] [INDEXER-API] failed to get shared tokens:`, String((err as Error).message));
      sendError(res, 500, "INDEXER_READ_FAILED", "failed to read indexer state");
    }
  });

  return router;
}
