import express from "express";
import type { NextFunction, Request, Response } from "express";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import {
  uploadUrlRateLimit,
  unpinRateLimit,
  gcRateLimit,
} from "../rate-limiter.ts";
import type { StorageAdapter } from "../storage/index.ts";
import { walkManifestChain } from "../manifest-chain-walker.ts";
import { runIpfsGC } from "../ipfs-gc.ts";
import { validateBody } from "../validation.ts";
import { unpinSchema, gcSchema, uploadUrlsSchema } from "../schemas.ts";
import { checkAssetAccess, getTokenUri } from "../authorization.ts";
import { getConfiguredContracts } from "../../config.ts";
import { maybeDecompress } from "../ipfs-utils.ts";

const Router = express.Router;

/**
 * Max `prev_asset_manifest_cid` links followed when verifying that a CID
 * belongs to a token's collection history.
 */
const MAX_COLLECTION_HISTORY_STEPS = 5;

/**
 * Verifies that `cid` belongs to the token's collection: the tokenURI CID
 * itself, or an asset manifest CID referenced by the collection's `assets`
 * map (including up to 5 `prev_asset_manifest_cid` ancestors).
 * @remarks The ancestor walk covers the delete-asset flow, where the orphaned
 *   manifest sits in the previous collection version. Fails closed by
 *   throwing when a collection manifest cannot be read.
 */
async function cidBelongsToToken(
  cid: string,
  tokenUriCid: string,
  storage: StorageAdapter,
): Promise<boolean> {
  if (!tokenUriCid) return false;
  if (cid === tokenUriCid) return true;

  let currentCid = tokenUriCid;
  for (
    let step = 0;
    step <= MAX_COLLECTION_HISTORY_STEPS && currentCid;
    step++
  ) {
    let manifest;
    try {
      const raw = await storage.catBytes(currentCid);
      const decompressed = await maybeDecompress(raw);
      manifest = JSON.parse(decompressed);
    } catch (e) {
      throw new Error(
        `cannot read collection manifest ${currentCid}: ${(e as Error).message}`,
      );
    }
    const assets =
      manifest && typeof manifest === "object" ? manifest.assets : null;
    if (assets && typeof assets === "object" && Object.values(assets).includes(cid)) {
      return true;
    }
    currentCid = manifest?.prev_asset_manifest_cid || null;
  }
  return false;
}

function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const adminToken = process.env.GC_ADMIN_TOKEN;
  if (!adminToken) {
    return sendError(res, 503, "GC_DISABLED", "GC admin token not configured");
  }
  const provided = req.headers["x-admin-token"];
  if (!provided || provided !== adminToken) {
    return sendError(res, 403, "FORBIDDEN", "Invalid or missing admin token");
  }
  next();
}

export default function ipfsRoutes(storage: StorageAdapter) {
  const router = Router();

  /**
   * POST /api/v1/ipfs/upload-url
   *
   * Mints a short-lived client upload credential.
   * @remarks Session-gated and rate-limited per wallet. Pinata mode returns a
   *   presigned URL; Kubo mode returns the local API URL. The master Pinata
   *   JWT never reaches the client.
   */
  router.post(
    "/upload-url",
    authenticate,
    uploadUrlRateLimit,
    async (req, res) => {
      try {
        const credential = await storage.mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential - strategy=${credential.strategy} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", (error as Error).message);
        sendError(res, 500, "UPLOAD_URL_FAILED", (error as Error).message);
      }
    },
  );

  /**
   * POST /api/v1/ipfs/upload-urls
   *
   * Mints several short-lived upload credentials in one call.
   * @remarks Session-gated and rate-limited per wallet. Pinata signed URLs are
   *   single-use, so a multi-file upload needs one credential per file — this
   *   endpoint does it in one round trip.
   *
   * Body: { count: number } (1-200, default 1)
   */
  router.post(
    "/upload-urls",
    authenticate,
    uploadUrlRateLimit,
    validateBody(uploadUrlsSchema),
    async (req, res) => {
      try {
        const { count } = req.body;
        const credentials = await storage.mintUploadCredentials(count);
        console.log(
          `[IPFS] minted ${credentials.length} upload credential(s) - strategy=${credentials[0]?.strategy} wallet=${res.locals.userAddress}`,
        );
        res.json({ credentials });
      } catch (error) {
        console.error("[IPFS] upload-urls error:", (error as Error).message);
        sendError(res, 500, "UPLOAD_URL_FAILED", (error as Error).message);
      }
    },
  );

  /**
   * POST /api/v1/ipfs/unpin
   *
   * Unpins the asset-unique CIDs owned by a manifest chain (called before
   * token burn or after asset removal).
   * @remarks Shared CIDs (source glTFs, bundle dirs, embedded buffers/images)
   *   are NOT unpinned — they may be referenced by other tokens — so this
   *   only unpins manifest-chain CIDs, thumbnails, and comments archives;
   *   shared CIDs are reclaimed by the GC. The session wallet must own the
   *   token or hold an editor proof, and the CID must belong to the claimed
   *   token (current/previous collection manifests), so a caller cannot unpin
   *   a victim's CIDs. A body-supplied `contractAddress` must be a configured
   *   contract (free/paid), or INVALID_CONTRACT is returned to stop spoofed
   *   ownerOf()/tokenURI() answers. Accepted residual risk: the membership
   *   anchors are attacker-settable for their own token at gas cost, so full
   *   closure needs reachability-based deletion (GC).
   *
   * Body: { cid, tokenId, chainId?, contractAddress?, proof? }
   *
   * Auth: Session token required.
   */
async function findMatchingContract(
  tokenId: string,
  chainId: number | null,
  sessionAddress: string,
  proof: any,
  startCid: string,
  candidates: string[],
  storage: StorageAdapter,
): Promise<{
  matched: { contractAddr: string; access: any } | null;
  error?: { status: number; code: string; message: string };
}> {
  let matched: { contractAddr: string; access: any } | null = null;
  let lastError: Error | null = null;
  let sawDenied = false;
  let sawMembershipMiss = false;
  for (const candidate of candidates) {
    let access;
    try {
      access = await checkAssetAccess(
        tokenId,
        chainId,
        sessionAddress,
        { proof, requiredRole: 2, contractAddress: candidate },
      );
    } catch (e) {
      lastError = e as Error;
      continue;
    }
    if (!access.allowed || access.role < 2) {
      sawDenied = true;
      continue;
    }

    let belongs;
    try {
      const tokenUri = await getTokenUri(tokenId, chainId, {
        contractAddress: candidate,
      });
      const tokenUriCid = tokenUri.replace(/^ipfs:\/\//, "");
      belongs = await cidBelongsToToken(startCid, tokenUriCid, storage);
    } catch (e) {
      console.error("[UNPIN] token collection unreadable:", (e as Error).message);
      return {
        matched: null,
        error: { status: 502, code: "COLLECTION_UNREADABLE", message: (e as Error).message },
      };
    }
    if (!belongs) {
      sawMembershipMiss = true;
      continue;
    }
    matched = { contractAddr: candidate, access };
    break;
  }

  if (!matched) {
    if (sawMembershipMiss) {
      return {
        matched: null,
        error: { status: 400, code: "CID_NOT_IN_TOKEN", message: `CID ${startCid} is not referenced by token ${tokenId}` },
      };
    }
    if (sawDenied) {
      console.warn(
        `[UNPIN] denied - ${sessionAddress} is not owner/editor of token ${tokenId}`,
      );
      return {
        matched: null,
        error: { status: 403, code: "FORBIDDEN", message: "Session wallet is not the token owner or an editor" },
      };
    }
    return {
      matched: null,
      error: { status: 400, code: "INVALID_TOKEN", message: lastError?.message || "Token not found on any configured contract" },
    };
  }
  return { matched };
}

  router.post("/unpin", authenticate, unpinRateLimit, validateBody(unpinSchema), async (req, res) => {
    const startTime = Date.now();
    try {
      const { cid: startCid, tokenId, chainId, contractAddress, proof } = req.body;
      const sessionAddress = res.locals.userAddress;

      console.log(`[UNPIN] starting from ${startCid} for token ${tokenId}`);

      // Contract candidates: a body-supplied contractAddress must be one of
      // the chain's configured contracts — otherwise an attacker could point
      // the checks at their own contract spoofing ownerOf()/tokenURI().
      const configured = getConfiguredContracts(chainId ?? null);
      let candidates: string[];
      if (contractAddress) {
        const allowlisted = configured.some(
          (a) => a.toLowerCase() === contractAddress.toLowerCase(),
        );
        if (!allowlisted) {
          return sendError(
            res,
            400,
            "INVALID_CONTRACT",
            "contractAddress is not a configured Arbesk contract for this chain",
          );
        }
        candidates = [contractAddress];
      } else {
        candidates = configured;
      }
      if (candidates.length === 0) {
        return sendError(
          res,
          400,
          "INVALID_TOKEN",
          `No contract configured for chain ${chainId ?? "default"}`,
        );
      }

      // Try each candidate contract in order (free tier first, then paid):
      // the first one where on-chain ownership/editor rights AND CID
      // membership both pass wins.
      const match = await findMatchingContract(
        tokenId,
        chainId ?? null,
        sessionAddress,
        proof,
        startCid,
        candidates,
        storage
      );
      if (match.error) {
        return sendError(res, match.error.status, match.error.code, match.error.message);
      }
      const matched = match.matched!;

      console.log(
        `[UNPIN] authorized via contract ${matched.contractAddr} (role=${matched.access.role})`,
      );

      const { assetUnique, shared, errors } = await walkManifestChain(
        startCid,
        {
          recurseIntoSources: false,
          recurseIntoCollectionAssets: false,
        },
        storage,
      );

      console.log(
        `[UNPIN] collected ${assetUnique.size} asset-unique + ${shared.size} shared CIDs`,
      );

      // Unpin each asset-unique CID
      const unpinned: string[] = [];
      for (const cid of assetUnique) {
        try {
          // The adapter treats "already unpinned" as success.
          await storage.unpin(cid);
          unpinned.push(cid);
          console.log(`[UNPIN] unpinned → ${cid}`);
        } catch (e) {
          console.warn(`[UNPIN] failed to unpin ${cid}: ${(e as Error).message}`);
          errors.push(`unpin ${cid}: ${(e as Error).message}`);
        }
      }

      for (const cid of shared) {
        console.log(`[UNPIN] skipped shared CID → ${cid}`);
      }

      const elapsed = Date.now() - startTime;
      console.log(
        `[UNPIN] done - ${unpinned.length} unpinned, ${shared.size} skipped, ${errors.length} errors (${elapsed}ms)`,
      );

      res.json({
        unpinned,
        skipped: Array.from(shared),
        count: unpinned.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("[UNPIN] error:", (error as Error).message);
      sendError(res, 500, "UNPIN_FAILED", (error as Error).message);
    }
  });

  /**
   * POST /api/v1/ipfs/gc
   *
   * Runs the reachability garbage collector.
   * @remarks Requires session auth plus an admin token in the `X-Admin-Token`
   *   header (GC_ADMIN_TOKEN).
   *
   * Body (all optional): { dryRun, maxUnpin, chainId }
   */
  router.post(
    "/gc",
    authenticate,
    requireAdminToken,
    gcRateLimit,
    validateBody(gcSchema),
    async (req, res) => {
      try {
        const { dryRun, maxUnpin, chainId } = req.body;
        const result = await runIpfsGC({
          dryRun,
          maxUnpin,
          chainId,
        }, storage);
        res.json(result);
      } catch (error) {
        console.error("[GC] route error:", (error as Error).message);
        sendError(res, 500, "GC_FAILED", (error as Error).message);
      }
    },
  );

  return router;
}
