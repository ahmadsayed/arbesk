import express from "express";
import abiRouter from "../abi-router.js";

const Router = express.Router;

/**
 * Serve contract ABI by name.
 * GET /api/v1/contracts/:name/abi
 */
export default function contractsRoutes() {
  const router = Router();

  router.get("/:name/abi", (req, res) => {
    const abiRouterInstance = abiRouter();
    // Forward to the existing ABI router logic
    req.url = `/${req.params.name}.json`;
    // @ts-ignore express.Router callable type expects a third next argument
    abiRouterInstance(req, res);
  });

  return router;
}
