import express from "express";
import { sendError } from "../errors.js";
import authenticate from "../authentication.js";
import { validateBody } from "../validation.js";
import { resolveEmailSchema } from "../schemas.js";
import { userResolveRateLimit } from "../rate-limiter.js";

const Router = express.Router;

/** @typedef {import("@coinbase/cdp-sdk").CdpClient} CdpClient */

// The CDP server SDK is loaded lazily: it is heavy, pulls a large dependency
// tree (which breaks Jest's ESM loader when imported statically), and is only
// needed when the route is actually called. Cached per env credential pair so
// tests and credential rotation pick up changes.
let _cdpClient = /** @type {CdpClient | null} */ (null);
let _cdpClientKey = "";

/**
 * @returns {Promise<CdpClient | null>} null when CDP_API_KEY_ID /
 * CDP_API_KEY_SECRET are not configured (feature unavailable, not an error).
 */
async function getCdpClient() {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) return null;
  const key = `${apiKeyId}:${apiKeySecret}`;
  if (!_cdpClient || _cdpClientKey !== key) {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    _cdpClient = new CdpClient({ apiKeyId, apiKeySecret });
    _cdpClientKey = key;
  }
  return _cdpClient;
}

/**
 * Scan the project's CDP end users for an exact full-email match and return
 * that user's smart account address. Need-to-know by design: exact match
 * only, no partial search, and only the smart account address is extracted —
 * never the userId, EOA, or the email itself.
 *
 * @param {CdpClient} cdp
 * @param {string} email - normalized (trimmed, lowercased) email
 * @returns {Promise<{ address: string | null } | null>} null when no end
 * user has this email; `address` is null when the user exists but has no
 * EVM smart account.
 */
async function resolveSmartAccountByEmail(cdp, email) {
  let pageToken = /** @type {string | undefined} */ (undefined);
  do {
    const page = await cdp.endUser.listEndUsers(
      pageToken ? { pageSize: 100, pageToken } : { pageSize: 100 },
    );
    for (const user of page.endUsers ?? []) {
      const methods = /** @type {{ type?: string; email?: string }[]} */ (
        user.authenticationMethods ?? []
      );
      const hit = methods.some(
        (m) =>
          m.type === "email" &&
          typeof m.email === "string" &&
          m.email.toLowerCase() === email,
      );
      if (hit) return { address: user.evmSmartAccounts?.[0] ?? null };
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return null;
}

/**
 * POST /api/v1/users/resolve-email
 *
 * Checks whether an email belongs to a CDP end user of this project and, if
 * so, returns the user's smart account address — the address an owner adds
 * to a token's Merkle editor list ("Add Editor via Email"). The requester
 * must supply the full, exact email: no listing, no partial matching, no
 * autocomplete. The response is minimal on purpose:
 *   { exists: false }                    — unknown email
 *   { exists: true, address }            — addable as an editor
 *   { exists: true, address: null }      — known user without a smart account
 *
 * Inviting emails that do not exist yet is a deliberate future enhancement
 * and out of scope here.
 *
 * Body: { email }
 * Auth: Session token required. Rate-limited per wallet to blunt email
 * enumeration. The email is never written to logs.
 */
export default function usersRoutes() {
  const router = Router();

  router.post(
    "/resolve-email",
    authenticate,
    userResolveRateLimit,
    validateBody(resolveEmailSchema),
    async (req, res) => {
      try {
        const cdp = await getCdpClient();
        if (!cdp) {
          return sendError(
            res,
            503,
            "CDP_NOT_CONFIGURED",
            "CDP server API key not configured",
          );
        }

        const result = await resolveSmartAccountByEmail(cdp, req.body.email);
        if (!result) {
          console.log("[USERS] resolve-email - no match");
          return res.json({ exists: false });
        }
        console.log(
          `[USERS] resolve-email - match (smart account: ${result.address ? "yes" : "none"})`,
        );
        res.json({ exists: true, address: result.address });
      } catch (error) {
        const err = /** @type {Error} */ (error);
        console.error("[USERS] resolve-email error:", err.message);
        sendError(res, 502, "CDP_LOOKUP_FAILED", "Email lookup failed");
      }
    },
  );

  return router;
}
