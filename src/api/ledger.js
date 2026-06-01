/**
 * Arbesk Micro-Ledger API
 *
 * GET  /api/ledger        — Query ledger entries with filters
 * GET  /api/ledger/stats  — Aggregated analytics
 */

import { Router } from "express";
import { queryLedger, getLedgerStats } from "../ledger/store.js";

export default () => {
  const router = Router();

  /**
   * GET /api/ledger
   * Query the audit trail with optional filters.
   */
  router.get("/", (req, res) => {
    try {
      const filters = {
        manifestId: req.query.manifestId || undefined,
        opType: req.query.opType || undefined,
        actorAddress: req.query.actorAddress || undefined,
        since: req.query.since ? Number(req.query.since) : undefined,
        until: req.query.until ? Number(req.query.until) : undefined,
        limit: req.query.limit ? Math.min(Number(req.query.limit), 500) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      };

      const result = queryLedger(filters);
      res.json(result);
    } catch (error) {
      console.error("[LEDGER] query error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ledger/stats
   * Aggregated analytics across all ledger entries.
   */
  router.get("/stats", (req, res) => {
    try {
      const stats = getLedgerStats();
      res.json(stats);
    } catch (error) {
      console.error("[LEDGER] stats error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
