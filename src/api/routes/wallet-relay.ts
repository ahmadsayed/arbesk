/**
 * Wallet relay route (P2d): executes an on-chain write
 * (publish / updateUri / updateEditors / burn) on behalf of an email-auth
 * (server-wallet) session.
 * @remarks No browser, no private key on the CLI.
 */
import { Hono } from "hono";
import fs from "fs";
import path from "path";
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
import { buildAssetUpdateEvent, createRelay } from "../nostr-relay.ts";
import { PROJECT_ROOT } from "../project-root.ts";

// sessions.ts / authz.ts / config.ts are lazy-loaded inside the handler — they
// sit in a dense static-import graph (identity → config → viem/web3) that breaks
// the full-app ESM import path when a route imports them statically.

const ABI_PATH = path.resolve(
  PROJECT_ROOT,
  "blockchain/artifacts/contracts/ArbeskAssetFree.sol/ArbeskAssetFree.json",
);
const CONTRACT_ABI: Abi = JSON.parse(fs.readFileSync(ABI_PATH, "utf8")).abi;

const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID || 84532);

/** bytes32(0) — collection-wide editor-grant scope (see #50). */
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** A body field that is meaningful only as a string; anything else is absent. */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export interface WalletRelayDeps {
  getCdpClientFn?: () => Promise<CdpClient | null>;
  getAuthz?: () => Authz;
}

async function authorizeRelay(
  authz: Authz,
  op: string,
  tokenId: any,
  cid: number,
  address: string,
  proof: any,
  requiredRole: any,
): Promise<{ error?: { status: number; code: string; message: string } }> {
  if (op === "publish") {
    // Minting a brand-new token: there is no prior owner to authorize against.
    // ownerOf reverting is the signal the token does not exist yet — the only
    // case where publish is valid.
    try {
      await authz.checkAssetAccess(tokenId, cid, address, { proof, requiredRole });
      return { error: { status: 409, code: "TOKEN_EXISTS", message: "Token already minted; publish creates a new token" } };
    } catch {
      // ownerOf reverted → token does not exist → mint allowed.
    }
  } else {
    const access = await authz.checkAssetAccess(tokenId, cid, address, {
      proof,
      requiredRole,
    });
    if (!access.allowed) {
      return { error: { status: 403, code: "PERMISSION_DENIED", message: "You do not have write access to this asset" } };
    }
  }
  return {};
}

async function executeRelayOp(
  contract: any,
  op: string,
  args: any,
): Promise<{ receipt?: any; error?: { status: number; code: string; message: string } }> {
  if (op === "publish") return { receipt: await contract.publish(args) };
  if (op === "updateUri") return { receipt: await contract.updateUri({ ...args, assetScope: args.assetScope ?? ZERO_HASH }) };
  if (op === "updateEditors") return { receipt: await contract.updateEditors(args) };
  if (op === "burn") return { receipt: await contract.burn(args) };
  return { error: { status: 400, code: "UNKNOWN_OP", message: "Unknown relay op: " + op } };
}

/**
 * address (lowercase) → resolved CDP end user.
 * @remarks An address-scan pages through every CDP end user, so cache hits;
 *   the address → userId mapping never changes. Misses are not cached (the
 *   user may delegate later).
 */
const relayUserCache = new Map<string, { userId: string; address: string }>();

/** Test hook: clears the address-scan cache. */
export function _resetRelayUserCache(): void {
  relayUserCache.clear();
}

/**
 * Resolves the CDP end-user id for a relay op.
 * @remarks Logs enough detail to diagnose "Smart account not found" failures:
 *   whether the userId came from the session or an address scan, and which
 *   smart-account list the address appeared in.
 */
async function resolveRelayUserId(
  cdp: any,
  record: any,
): Promise<{ userId: string | null; address: string }> {
  if (record.userId) {
    console.log("[RELAY] session userId=" + record.userId + " address=" + record.address);
    return { userId: record.userId, address: record.address };
  }
  const key = record.address.toLowerCase();
  const cached = relayUserCache.get(key);
  if (cached) {
    console.log("[RELAY] cached userId=" + cached.userId + " address=" + cached.address);
    return cached;
  }
  const u: { userId?: string; evmSmartAccounts?: string[] } | null =
    await findEndUserByAddress(cdp, record.address);
  if (!u) {
    console.log("[RELAY] address-scan found NO end-user for address=" + record.address);
    return { userId: null, address: record.address };
  }
  // CDP stores addresses EIP-55 checksummed; sendUserOperation is
  // case-sensitive, so use the canonical stored form, not the lowercase
  // session address.
  const canonical = u.evmSmartAccounts?.[0] || record.address;
  console.log(
    "[RELAY] address-scan userId=" + u.userId +
    " | sessionAddress=" + record.address +
    " | canonicalAddress=" + canonical
  );
  if (u.userId) relayUserCache.set(key, { userId: u.userId, address: canonical });
  return { userId: u.userId ?? null, address: canonical };
}

/**
 * Publishes a live-update Nostr event for a token whose URI just changed via
 * the wallet relay (CLI/MCP/CDP path). Fire-and-forget: never block the save.
 */
async function publishLiveUpdate(
  chainId: number,
  contractAddress: string,
  tokenId: string,
  newAssetURI: string,
  assetId: string | null = null,
): Promise<void> {
  try {
    const { NOSTR_SERVICE_PRIVATE_KEY, NOSTR_RELAY_URL } = await import("../../config.ts");
    if (!NOSTR_SERVICE_PRIVATE_KEY || !NOSTR_RELAY_URL) return;
    const event = buildAssetUpdateEvent(NOSTR_SERVICE_PRIVATE_KEY, {
      chainId,
      contractAddress,
      tokenId,
      newAssetURI,
      assetId,
    });
    const relay = createRelay(NOSTR_RELAY_URL);
    await relay.connect();
    await relay.publish(event);
    relay.close();
    console.log(`[RELAY] live update published | token=${tokenId} chain=${chainId}`);
  } catch (err) {
    console.warn(`[RELAY] live update publish failed | token=${tokenId}:`, (err as Error).message);
  }
}

export default function walletRelayRoutes(deps: WalletRelayDeps = {}) {
  const getCdp = deps.getCdpClientFn ?? getCdpClient;
  const app = new Hono();

  app.post("/", walletRelayRateLimit, validateBody(walletRelaySchema), async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Session ")) {
      return sendError(c, 401, "MISSING_SESSION", "Session token required");
    }
    const token = authHeader.slice(8);

    const { getSessionRecord } = await import("../sessions.ts");
    const record = getSessionRecord(token);
    if (!record) {
      return sendError(c, 401, "INVALID_SESSION", "Session invalid or expired");
    }
    const { op, tokenId, chainId, contractAddress, proof, requiredRole, params = {} } = c.req.valid("json");

    try {
      const { getContractAddress } = await import("../../config.ts");
      const cid = chainId ?? DEFAULT_CHAIN_ID;
      const contractAddr =
        contractAddress ?? getContractAddress(cid) ?? process.env.CONTRACT_ADDRESS;
      if (!contractAddr) throw new Error("No contract address resolved for chain " + cid);

      const authz = deps.getAuthz
        ? deps.getAuthz()
        : (await import("../authz.ts")).createAuthzInstance();

      const authzResult = await authorizeRelay(authz, op, tokenId, cid, record.address, proof, requiredRole);
      if (authzResult.error) {
        return sendError(c, authzResult.error.status, authzResult.error.code, authzResult.error.message);
      }

      const cdp = await getCdp();
      if (!cdp) {
        return sendError(c, 503, "CDP_NOT_CONFIGURED", "CDP server API key not configured");
      }

      const { userId, address } = await resolveRelayUserId(cdp, record);
      if (!userId) {
        return sendError(
          c,
          403,
          "DELEGATION_REQUIRED",
          "No delegated wallet for this session. Log in via the browser to grant a delegation.",
        );
      }

      console.log("[RELAY] sending op=" + op + " userId=" + userId + " address=" + address + " chain=" + cid);

      const signer = createCdpServerSigner({
        cdp,
        userId,
        address,
        chainId: cid,
      });
      const contract = createAssetContract({
        signer,
        address: contractAddr,
        abi: CONTRACT_ABI,
      });

      const args = { tokenId, ...params };
      const result = await executeRelayOp(contract, op, args);
      if (result.error) {
        return sendError(c, result.error.status, result.error.code, result.error.message);
      }
      if (op === "updateUri" && typeof params.newUri === "string") {
        publishLiveUpdate(cid, contractAddr, String(tokenId), params.newUri, stringOrNull(params.assetId)).catch(() => {});
      }
      return c.json({ receipt: result.receipt }, 200);
    } catch (err) {
      const e = err as Error;
      console.error("[RELAY] failed:", e.message);
      return sendError(c, 502, "RELAY_FAILED", "Relay operation failed");
    }
  });

  return app;
}
