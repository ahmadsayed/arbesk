import { Hono } from "hono";

// Dynamic import to ensure process.env is populated before config.ts reads it.
// api/index.ts is loaded via dynamic import() from index.ts after process.loadEnvFile runs.
const {
  CONTRACT_ADDRESS,
  HARDHAT_RPC_URL,
  NETWORK_CONFIGS,
  DEFAULT_CHAIN_ID,
  getContractAddress,
} = await import("../config.ts");

import generateAssetNode from "./assets/generate-node.ts";
import cadRoutes from "./routes/cad.ts";
import followupIntentRoutes from "./routes/followup-intent.ts";
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
  const v1 = new Hono();

  // Request bodies are parsed per route by the validators (src/api/validation.ts);
  // the size cap is the bodyLimit applied in src/index.ts.

  // ─── Config ───────────────────────────────────────────────────────────────

  v1.get("/config", (c) =>
    c.json({
      contractAddress: CONTRACT_ADDRESS,
      networkConfigs: NETWORK_CONFIGS,
      defaultChainId: DEFAULT_CHAIN_ID,
      ipfsBackend: storage.backend,
      ipfsGatewayUrl: storage.gatewayBase(),
      hardhatRpcUrl: HARDHAT_RPC_URL,
      mockGeneration: process.env.MOCK_3D_GENERATION === "true",
      cadGeneration:
        process.env.CAD_MOCK_GENERATION === "true" ||
        (process.env.DEEPSEEK_API_KEY ?? "").trim().length > 0,
      cdpProjectId: process.env.CDP_PROJECT_ID || null,
      nostrPublicUrl: process.env.PUBLIC_NOSTR_URL || null,
    }),
  );

  // ─── Sessions ────────────────────────────────────────────────────────────

  v1.route("/sessions", sessionRouter());

  // ─── Generations ──────────────────────────────────────────────────────────

  v1.route("/generations", generateAssetNode(core, storage));

  // ─── CAD generation (code only; the client runs the kernel) ────────────────

  v1.route("/cad", cadRoutes());

  // ─── Follow-up intent (Jev reads what a typed follow-up asks for) ─────────

  v1.route("/followup-intent", followupIntentRoutes());

  // ─── Comments Archive ─────────────────────────────────────────────────────

  v1.route("/assets", commentsRoutes({ getContractAddress, storage }));

  // ─── IPFS Upload Credential / Unpin ────────────────────────────────────────

  v1.route("/ipfs", ipfsRoutes(storage));

  // ─── Contracts ────────────────────────────────────────────────────────────

  v1.route("/contracts", contractsRoutes());

  // ─── Token Ownership Indexer ───────────────────────────────────────────────

  v1.route("/indexer", indexerRoutes(storage));

  // ─── CDP Paymaster Proxy ───────────────────────────────────────────────────

  v1.route("/paymaster", paymasterRoutes());

  // ─── Users (CDP email → smart account resolution) ──────────────────────────

  v1.route("/users", usersRoutes());

  // ─── Email OTP Auth ────────────────────────────────────────────────────────

  v1.route("/auth/email", emailAuthRoutes());

  // ─── Wallet Relay (server-wallet on-chain writes) ─────────────────────────

  v1.route("/wallet/relay", walletRelayRoutes());

  // ─── CLI browser-assisted login page ──────────────────────────────────────

  v1.route("/cli-auth", cliAuthRoutes());

  // ─── Dev console bridge (browser → stdout, diagnostics sink) ───────────────

  if (process.env.NODE_ENV !== "production") {
    v1.route("/dev", devConsoleRoutes());
  }

  // ─── OpenAPI Specification ─────────────────────────────────────────────────

  v1.route("/", openapiRoutes());

  // ─── Test-only utilities ───────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    v1.route("/test", testUtilsRoutes());
  }

  // ─── Mount under /api/v1 ──────────────────────────────────────────────────

  const api = new Hono();
  api.route("/v1", v1);

  return api;
};
