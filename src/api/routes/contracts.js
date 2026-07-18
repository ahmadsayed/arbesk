import express from "express";
import abiRouter from "../abi-router.js";

const Router = express.Router;

// Constructed once at module level: the ABI router is stateless (it only
// resolves artifact paths per request), so there is no reason to rebuild it
// on every call.
const abiRouterInstance = abiRouter();

/**
 * Serve contract ABI by name.
 * GET /api/v1/contracts/:name/abi
 */
export default function contractsRoutes() {
  const router = Router();

  router.get("/:name/abi", (req, res, next) => {
    // Forward to the shared ABI router logic, which routes on `/<name>.json`.
    req.url = `/${req.params.name}.json`;
    abiRouterInstance(req, res, next);
  });

  return router;
}
