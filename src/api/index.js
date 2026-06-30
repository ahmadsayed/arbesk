import express from "express";

const Router = express.Router;

// Dynamic import to ensure process.env is populated before config.js reads it.
// api/index.js is loaded via dynamic import() from index.js after dotenv runs.
const {
  CONTRACT_ADDRESS,
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
import indexerRoutes from "./routes/indexer.js";
import openapiRoutes from "./routes/openapi.js";
import testUtilsRoutes from "./routes/test-utils.js";
import paymasterRoutes from "./routes/paymaster.js";
import { maybeDecompress } from "./ipfs-utils.js";
// ─── Router ─────────────────────────────────────────────────────────────────

export default () => {
  const v1 = Router();

  // JSON body parsing and content-type enforcement are handled by the
  // body-parser.json() middleware applied in src/index.js before /api is mounted.

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
      cdpProjectId: process.env.CDP_PROJECT_ID || null,
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

  // ─── Token Ownership Indexer ───────────────────────────────────────────────

  v1.use("/indexer", indexerRoutes());

  // ─── CDP Paymaster Proxy ───────────────────────────────────────────────────

  v1.use("/paymaster", paymasterRoutes());

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
  /** @type {any} */
  const apiAny = api;
  apiAny._getFromIPFS = async (/** @type {string} */ cid) => {
    const raw = await getStorage().catBytes(cid);
    return maybeDecompress(raw);
  };

  return api;
};
