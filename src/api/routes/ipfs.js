import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import {
  uploadUrlRateLimit,
  unpinRateLimit,
  gcRateLimit,
} from "../rate-limiter.js";
import { getStorage } from "../storage/index.js";
import { walkManifestChain } from "../manifest-chain-walker.js";
import { runIpfsGC } from "../ipfs-gc.js";
import { validateBody } from "../validation.js";
import { unpinSchema, gcSchema, uploadUrlsSchema } from "../schemas.js";
import { checkAssetAccess, getTokenUri } from "../authorization.js";
import { getConfiguredContracts } from "../../config.js";
import { maybeDecompress } from "../ipfs-utils.js";

const Router = express.Router;

/**
 * Max `prev_asset_manifest_cid` links followed when verifying that a CID
 * belongs to a token's collection history.
 */
const MAX_COLLECTION_HISTORY_STEPS = 5;

/**
 * Verify that `cid` belongs to the token's collection: it is either the
 * tokenURI CID itself, or an asset manifest CID referenced by the collection
 * manifest's `assets` map — including up to 5 `prev_asset_manifest_cid`
 * ancestors. The ancestor walk covers the delete-asset flow, where the
 * orphaned asset manifest sits in the previous collection version.
 *
 * Fails closed by throwing when a collection manifest cannot be read; the
 * caller must not silently allow the unpin in that case.
 *
 * @param {string} cid - CID the caller wants to unpin
 * @param {string} tokenUriCid - CID currently referenced by tokenURI(tokenId)
 * @returns {Promise<boolean>}
 */
async function cidBelongsToToken(cid, tokenUriCid) {
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
      const raw = await getStorage().catBytes(currentCid);
      const decompressed = await maybeDecompress(raw);
      manifest = JSON.parse(decompressed);
    } catch (e) {
      throw new Error(
        `cannot read collection manifest ${currentCid}: ${(/** @type {Error} */ (e)).message}`,
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

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdminToken(req, res, next) {
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

export default function ipfsRoutes() {
  const router = Router();

  /**
   * POST /api/v1/ipfs/upload-url
   * Mint a short-lived client upload credential. Session-gated and rate-limited
   * per wallet. In Pinata mode returns a presigned URL; in Kubo mode returns the
   * local API URL. The master Pinata JWT never reaches the client.
   */
  router.post(
    "/upload-url",
    authenticate,
    uploadUrlRateLimit,
    async (req, res) => {
      try {
        const credential = await getStorage().mintUploadCredential();
        console.log(
          `[IPFS] minted upload credential - backend=${credential.backend} wallet=${res.locals.userAddress}`,
        );
        res.json(credential);
      } catch (error) {
        console.error("[IPFS] upload-url error:", (/** @type {Error} */ (error)).message);
        sendError(res, 500, "UPLOAD_URL_FAILED", (/** @type {Error} */ (error)).message);
      }
    },
  );

  /**
   * POST /api/v1/ipfs/upload-urls
   *
   * Mint several short-lived upload credentials in one call. Session-gated
   * and rate-limited per wallet (same budget as /upload-url). Pinata signed
   * URLs are single-use, so a client uploading N files must request N
   * credentials up front rather than reusing one mint - this endpoint lets it
   * do that in one round trip plus one parallelized Pinata sign burst,
   * instead of N sequential backend + Pinata round trips.
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
        const credentials = await getStorage().mintUploadCredentials(count);
        console.log(
          `[IPFS] minted ${credentials.length} upload credential(s) - backend=${credentials[0]?.backend} wallet=${res.locals.userAddress}`,
        );
        res.json({ credentials });
      } catch (error) {
        console.error("[IPFS] upload-urls error:", (/** @type {Error} */ (error)).message);
        sendError(res, 500, "UPLOAD_URL_FAILED", (/** @type {Error} */ (error)).message);
      }
    },
  );

  /**
   * POST /api/v1/ipfs/unpin
   *
   * Unpin the asset-unique CIDs owned by a manifest chain. Called before token
   * burn or after asset removal from a collection.
   *
   * Because source glTFs, bundle directories, and their embedded buffers/images
   * can be shared across multiple assets via deduplication, this endpoint does
   * NOT unpin them. It only unpins:
   *   - the manifest chain CIDs themselves
   *   - asset manifest thumbnails
   *   - asset manifest comments archives
   *
   * Shared CIDs are reported in `skipped` and reclaimed later by the
   * reachability garbage collector (`POST /api/v1/ipfs/gc`).
   *
   * Body: { cid: "baf...", tokenId: "123", chainId?, contractAddress?, proof? }
   *
   * Auth: Session token required. The session wallet must own the token or be
   * an editor (Merkle proof), verified on-chain via checkAssetAccess while the
   * token is still live — the frontend therefore unpins BEFORE burning. The
   * CID must also belong to the claimed token (it is the tokenURI CID or an
   * asset CID in the current/previous collection manifests), so a caller
   * cannot unpin a victim's CIDs by passing their own tokenId.
   *
   * Contract selection: a body-supplied `contractAddress` must be one of the
   * chain's configured contracts (free or paid tier) — anything else is
   * rejected with INVALID_CONTRACT, because an attacker-deployed contract
   * could otherwise spoof ownerOf()/tokenURI() answers. When omitted, the
   * configured contracts are tried in order (free, then paid) and the first
   * one where ownership + CID membership fully pass wins.
   *
   * Residual risk (accepted, documented): the membership anchors — tokenURI
   * and the collection's assets map — are attacker-settable for the
   * attacker's OWN token at gas cost (updateAssetURI does no URI validation,
   * and fork mode legitimately shares asset CIDs across collections), so a
   * determined caller can anchor a foreign CID to their own token; every such
   * attempt is attributed on-chain. Full closure requires reachability-based
   * deletion (GC semantics) and is a known mainnet follow-up.
   */
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
      /** @type {string[]} */
      let candidates;
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
      // membership both pass wins. A token that only exists on the paid
      // contract misses on the free one (ownerOf reverts) and matches later.
      let matched = null;
      let lastError = null;
      let sawDenied = false;
      let sawMembershipMiss = false;
      for (const candidate of candidates) {
        let access;
        try {
          access = await checkAssetAccess(
            tokenId,
            chainId ?? null,
            sessionAddress,
            { proof, requiredRole: 2, contractAddress: candidate },
          );
        } catch (e) {
          // Token does not exist on this contract — try the next candidate.
          lastError = /** @type {Error} */ (e);
          continue;
        }
        if (!access.allowed || access.role < 2) {
          sawDenied = true;
          continue;
        }

        // The CID must belong to the claimed token, otherwise an attacker
        // could pass their own tokenId and unpin a victim's manifest chain.
        let belongs;
        try {
          const tokenUri = await getTokenUri(tokenId, chainId ?? null, {
            contractAddress: candidate,
          });
          const tokenUriCid = tokenUri.replace(/^ipfs:\/\//, "");
          belongs = await cidBelongsToToken(startCid, tokenUriCid);
        } catch (e) {
          // Fail closed: an unreadable collection manifest must not silently
          // allow the unpin.
          console.error("[UNPIN] token collection unreadable:", (/** @type {Error} */ (e)).message);
          return sendError(res, 502, "COLLECTION_UNREADABLE", (/** @type {Error} */ (e)).message);
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
          return sendError(
            res,
            400,
            "CID_NOT_IN_TOKEN",
            `CID ${startCid} is not referenced by token ${tokenId}`,
          );
        }
        if (sawDenied) {
          console.warn(
            `[UNPIN] denied - ${sessionAddress} is not owner/editor of token ${tokenId}`,
          );
          return sendError(
            res,
            403,
            "FORBIDDEN",
            "Session wallet is not the token owner or an editor",
          );
        }
        return sendError(
          res,
          400,
          "INVALID_TOKEN",
          lastError?.message || "Token not found on any configured contract",
        );
      }

      console.log(
        `[UNPIN] authorized via contract ${matched.contractAddr} (role=${matched.access.role})`,
      );

      const { assetUnique, shared, errors } = await walkManifestChain(
        startCid,
        {
          recurseIntoSources: false,
          recurseIntoCollectionAssets: false,
        },
      );

      console.log(
        `[UNPIN] collected ${assetUnique.size} asset-unique + ${shared.size} shared CIDs`,
      );

      // Unpin each asset-unique CID
      const unpinned = [];
      for (const cid of assetUnique) {
        try {
          // The adapter treats "already unpinned" as success.
          await getStorage().unpin(cid);
          unpinned.push(cid);
          console.log(`[UNPIN] unpinned → ${cid}`);
        } catch (e) {
          console.warn(`[UNPIN] failed to unpin ${cid}: ${(/** @type {Error} */ (e)).message}`);
          errors.push(`unpin ${cid}: ${(/** @type {Error} */ (e)).message}`);
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
      console.error("[UNPIN] error:", (/** @type {Error} */ (error)).message);
      sendError(res, 500, "UNPIN_FAILED", (/** @type {Error} */ (error)).message);
    }
  });

  /**
   * POST /api/v1/ipfs/gc
   *
   * Run the reachability garbage collector. Requires session auth plus an
   * admin token in the `X-Admin-Token` header (configured via GC_ADMIN_TOKEN).
   *
   * Body (all optional):
   *   {
   *     "dryRun": true,           // default true
   *     "maxUnpin": 1000,         // default Infinity
   *     "chainId": 31337          // default from env
   *   }
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
        });
        res.json(result);
      } catch (error) {
        console.error("[GC] route error:", (/** @type {Error} */ (error)).message);
        sendError(res, 500, "GC_FAILED", (/** @type {Error} */ (error)).message);
      }
    },
  );

  return router;
}
