/**
 * Wallet relay route (P2d).
 *
 * Executes an on-chain write (publish / updateUri / updateEditors / burn) on
 * behalf of an email-auth (server-wallet) session: resolves the CDP end-user
 * id, checks access via @arbesk/authz, ABI-encodes the call through
 * @arbesk/wallet createAssetContract, and submits it as a paymaster-sponsored
 * UserOperation via the CDP server SDK. No browser, no private key on the CLI.
 */
import express from "express";
import fs from "fs";
import path from "path";
import url from "url";
import type { Request, Response } from "express";
import type { CdpClient } from "@coinbase/cdp-sdk";
import type { Authz } from "@arbesk/authz";
import { createAssetContract } from "@arbesk/wallet";
import type { Abi } from "viem";
import { sendError } from "../errors.ts";
import { validateBody } from "../validation.ts";
import { walletRelaySchema } from "../schemas.ts";
import { walletRelayRateLimit } from "../rate-limiter.ts";
import { getCdpClient, findEndUserByAddress } from "../cdp.ts";
import { createCdpServerSigner } from "../cdp-signer.ts";

// sessions.ts / authz.ts / config.ts are lazy-loaded inside the handler — they
// sit in a dense static-import graph (identity → config → viem/web3) that breaks
// the full-app ESM import path when a route imports them statically.

const Router = express.Router;

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ABI_PATH = path.resolve(
  __dirname,
  "../../../blockchain/artifacts/contracts/ArbeskAssetFree.sol/ArbeskAssetFree.json",
);
const CONTRACT_ABI: Abi = JSON.parse(fs.readFileSync(ABI_PATH, "utf8")).abi;

const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID || 84532);

export interface WalletRelayDeps {
  getCdpClientFn?: () => Promise<CdpClient | null>;
  getAuthz?: () => Authz;
}

export default function walletRelayRoutes(deps: WalletRelayDeps = {}) {
  const getCdp = deps.getCdpClientFn ?? getCdpClient;
  const router = Router();

  router.post("/", walletRelayRateLimit, validateBody(walletRelaySchema), async (req: Request, res: Response) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Session ")) {
      return sendError(res, 401, "MISSING_SESSION", "Session token required");
    }
    const token = authHeader.slice(8);

    const { getSessionRecord } = await import("../sessions.ts");
    const record = getSessionRecord(token);
    if (!record) {
      return sendError(res, 401, "INVALID_SESSION", "Session invalid or expired");
    }
    const { op, tokenId, chainId, contractAddress, proof, requiredRole, params = {} } = req.body;

    try {
      const { getContractAddress } = await import("../../config.ts");
      const cid = chainId ?? DEFAULT_CHAIN_ID;
      const contractAddr =
        contractAddress ?? getContractAddress(cid) ?? process.env.CONTRACT_ADDRESS;
      if (!contractAddr) throw new Error("No contract address resolved for chain " + cid);

      const authz = deps.getAuthz
        ? deps.getAuthz()
        : (await import("../authz.ts")).createAuthzInstance();

      if (op === "publish") {
        // Minting a brand-new token: there is no prior owner to authorize
        // against. A valid session + delegated wallet (both checked below) is
        // the gate, and the contract reverts on a TokenAlreadyMinted collision.
        // ownerOf reverting is the signal the token does not exist yet — the
        // only case where publish is valid.
        try {
          await authz.checkAssetAccess(tokenId, cid, record.address, { proof, requiredRole });
          return sendError(res, 409, "TOKEN_EXISTS", "Token already minted; publish creates a new token");
        } catch {
          // ownerOf reverted → token does not exist → mint allowed.
        }
      } else {
        const access = await authz.checkAssetAccess(tokenId, cid, record.address, {
          proof,
          requiredRole,
        });
        if (!access.allowed) {
          return sendError(res, 403, "PERMISSION_DENIED", "You do not have write access to this asset");
        }
      }

      const cdp = await getCdp();
      if (!cdp) {
        return sendError(res, 503, "CDP_NOT_CONFIGURED", "CDP server API key not configured");
      }

      let userId = record.userId ?? null;
      if (!userId) {
        const u = await findEndUserByAddress(cdp, record.address);
        userId = u?.userId ?? null;
      }
      if (!userId) {
        return sendError(
          res,
          403,
          "DELEGATION_REQUIRED",
          "No delegated wallet for this session. Log in via the browser to grant a delegation.",
        );
      }

      const signer = createCdpServerSigner({
        cdp,
        userId,
        address: record.address,
        chainId: cid,
      });
      const contract = createAssetContract({
        signer,
        address: contractAddr,
        abi: CONTRACT_ABI,
      });

      const args = { tokenId, ...params };
      let receipt;
      if (op === "publish") receipt = await contract.publish(args);
      else if (op === "updateUri") receipt = await contract.updateUri(args);
      else if (op === "updateEditors") receipt = await contract.updateEditors(args);
      else if (op === "burn") receipt = await contract.burn(args);
      else return sendError(res, 400, "UNKNOWN_OP", "Unknown relay op: " + op);

      res.status(200).json({ receipt });
    } catch (err) {
      const e = err as Error;
      console.error("[RELAY] failed:", e.message);
      sendError(res, 502, "RELAY_FAILED", "Relay operation failed");
    }
  });

  return router;
}
