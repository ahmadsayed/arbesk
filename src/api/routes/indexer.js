import express from "express";
import { getIndexer } from "../token-indexer.js";
import { validateQuery } from "../validation.js";
import { ownedQuerySchema } from "../schemas.js";

const Router = express.Router;

/**
 * Indexer API routes.
 *
 * GET /api/v1/indexer/owned?address=0x...&chainId=10143
 * Returns the token IDs owned by the given address on the given chain.
 */
export default function indexerRoutes() {
  const router = Router();

  router.get("/owned", validateQuery(ownedQuerySchema), async (req, res) => {
    const { address, chainId } = /** @type {{ address: string, chainId: number }} */ (/** @type {unknown} */ (req.query));

    try {
      const indexer = getIndexer(chainId);
      const owned = indexer.getOwnedTokens(address);
      res.json({
        chainId,
        address: address.toLowerCase(),
        owned,
        lastScannedBlock: indexer.lastScannedBlock,
      });
    } catch (err) {
      console.error("[INDEXER-API] failed to get owned tokens:", String(/** @type {Error} */ (err).message));
      res.status(500).json({ error: "failed to read indexer state" });
    }
  });

  return router;
}
