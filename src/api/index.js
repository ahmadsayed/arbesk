import express from "express";

const Router = express.Router;

// Dynamic import to ensure process.env is populated before config.js reads it.
// api/index.js is loaded via dynamic import() from index.js after dotenv runs.
const {
  CONTRACT_ADDRESS,
  ASSETS_IPFS,
  HARDHAT_RPC_URL,
  NETWORK_CONFIGS,
  getContractAddress,
} = await import("../config.js");

import generateAssetNode from "./assets/generate-node.js";
import { getStorage } from "./storage/index.js";
import sessionRouter from "./sessions.js";
import commentsRoutes from "./routes/comments.js";
import ipfsRoutes from "./routes/ipfs.js";
import contractsRoutes from "./routes/contracts.js";
import openapiRoutes from "./routes/openapi.js";
import testUtilsRoutes from "./routes/test-utils.js";
import { sendError } from "./errors.js";
import { maybeDecompress } from "./ipfs-utils.js";

// ─── Middleware & Helpers ────────────────────────────────────────────────────

/**
 * Reject requests that are not application/json.
 */
function requireJson(req, res, next) {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    !req.is("application/json")
  ) {
    return sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  next();
}

// ─── Router ─────────────────────────────────────────────────────────────────

export default () => {
  const v1 = Router();

  // Apply JSON validation to all mutating routes
  v1.use(requireJson);

  // ─── Config ───────────────────────────────────────────────────────────────

  v1.get("/config", (req, res) => {
    const storage = getStorage();
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      networkConfigs: NETWORK_CONFIGS,
      ipfsBackend: storage.backend,
      ipfsGatewayUrl: storage.gatewayBase(),
      hardhatRpcUrl: HARDHAT_RPC_URL,
      mockGeneration: process.env.MOCK_3D_GENERATION === "true",
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null,
    });
  });

  // ─── Sessions ────────────────────────────────────────────────────────────

  v1.use("/sessions", sessionRouter());

  // ─── Generations ──────────────────────────────────────────────────────────

  v1.use("/generations", generateAssetNode());

  // ─── Comments Archive ─────────────────────────────────────────────────────

  v1.use("/assets", commentsRoutes({ getContractAddress }));

  // ─── IPFS Upload Credential / Unpin ────────────────────────────────────────

  v1.use("/ipfs", ipfsRoutes());

  // ─── Contracts ────────────────────────────────────────────────────────────

  v1.use("/contracts", contractsRoutes());

  // ─── OpenAPI Specification ─────────────────────────────────────────────────

  v1.use("/", openapiRoutes());

  // ─── Test-only utilities ───────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    v1.use("/test", testUtilsRoutes());
  }

  // ─── Mount under /api/v1 ──────────────────────────────────────────────────

  const api = Router();
  api.use("/v1", v1);

  // Expose for test helpers
  api._getFromIPFS = async (cid) => {
    const raw = await getStorage().cat(cid);
    return maybeDecompress(raw);
  };

  return api;
};
