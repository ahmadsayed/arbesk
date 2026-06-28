import express from "express";
import { getIndexer } from "../token-indexer.js";

const Router = express.Router;

/**
 * Indexer API routes.
 *
 * GET /api/v1/indexer/owned?address=0x...&chainId=10143
 * Returns the token IDs owned by the given address on the given chain.
 */
export default function indexerRoutes() {
  const router = Router();

  router.get("/owned", async (req, res) => {
    const { address, chainId } = req.query;

    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "address is required" });
    }
    if (!chainId || typeof chainId !== "string") {
      return res.status(400).json({ error: "chainId is required" });
    }

    const id = Number(chainId);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "chainId must be a positive integer" });
    }

    try {
      const indexer = getIndexer(id);
      const owned = indexer.getOwnedTokens(address);
      res.json({
        chainId: id,
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
