import express from "express";
import type { Request, Response } from "express";

const Router = express.Router;

// Dynamic import to ensure process.env is populated before config.ts reads it.
// api/index.ts is loaded via dynamic import() from index.ts after dotenv runs.
const {
  CONTRACT_ADDRESS,
  HARDHAT_RPC_URL,
  NETWORK_CONFIGS,
  DEFAULT_CHAIN_ID,
  getContractAddress,
} = await import("../config.ts");

import generateAssetNode from "./assets/generate-node.ts";
import type { StorageAdapter } from "./storage/index.ts";
import type { ArbeskCore } from "@arbesk/asset-core/facade.js";
import sessionRouter from "./sessions.ts";
import commentsRoutes from "./routes/comments.ts";
import ipfsRoutes from "./routes/ipfs.ts";
import contractsRoutes from "./routes/contracts.ts";
import indexerRoutes from "./routes/indexer.ts";
import openapiRoutes from "./routes/openapi.ts";
import testUtilsRoutes from "./routes/test-utils.ts";
import paymasterRoutes from "./routes/paymaster.ts";
import usersRoutes from "./routes/users.ts";
import emailAuthRoutes from "./routes/email-auth.ts";
import walletRelayRoutes from "./routes/wallet-relay.ts";
import cliAuthRoutes from "./routes/cli-auth.ts";
import devConsoleRoutes from "./routes/dev-console.ts";
// ─── Router ─────────────────────────────────────────────────────────────────

interface ApiDeps {
  storage: StorageAdapter;
  core: ArbeskCore;
}

export default (deps: ApiDeps) => {
  const { storage, core } = deps;
  const v1 = Router();

  // JSON body parsing is handled by the express.json() middleware applied in
  // src/index.ts before /api is mounted.

  // ─── Config ───────────────────────────────────────────────────────────────

  v1.get("/config", (req: Request, res: Response) => {
    res.json({
      contractAddress: CONTRACT_ADDRESS,
      networkConfigs: NETWORK_CONFIGS,
      defaultChainId: DEFAULT_CHAIN_ID,
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

  v1.use("/generations", generateAssetNode(core, storage));

  // ─── Comments Archive ─────────────────────────────────────────────────────

  v1.use("/assets", commentsRoutes({ getContractAddress, storage }));

  // ─── IPFS Upload Credential / Unpin ────────────────────────────────────────

  v1.use("/ipfs", ipfsRoutes(storage));

  // ─── Contracts ────────────────────────────────────────────────────────────

  v1.use("/contracts", contractsRoutes());

  // ─── Token Ownership Indexer ───────────────────────────────────────────────

  v1.use("/indexer", indexerRoutes(storage));

  // ─── CDP Paymaster Proxy ───────────────────────────────────────────────────

  v1.use("/paymaster", paymasterRoutes());

  // ─── Users (CDP email → smart account resolution) ──────────────────────────

  v1.use("/users", usersRoutes());

  // ─── Email OTP Auth ────────────────────────────────────────────────────────

  v1.use("/auth/email", emailAuthRoutes());

  // ─── Wallet Relay (server-wallet on-chain writes) ─────────────────────────

  v1.use("/wallet/relay", walletRelayRoutes());

  // ─── CLI browser-assisted login page ──────────────────────────────────────

  v1.use("/cli-auth", cliAuthRoutes());

  // ─── Dev console bridge (browser → stdout, diagnostics sink) ───────────────

  if (process.env.NODE_ENV !== "production") {
    v1.use("/dev", devConsoleRoutes());
  }

  // ─── OpenAPI Specification ─────────────────────────────────────────────────

  v1.use("/", openapiRoutes());

  // ─── Test-only utilities ───────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    v1.use("/test", testUtilsRoutes());
  }

  // ─── Mount under /api/v1 ──────────────────────────────────────────────────

  const api = Router();
  api.use("/v1", v1);

  return api;
};
