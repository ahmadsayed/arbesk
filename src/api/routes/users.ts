import express from "express";
import type { CdpClient } from "@coinbase/cdp-sdk";
import { getCdpClient, findEndUserByEmail } from "../cdp.ts";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import { validateBody } from "../validation.ts";
import { resolveEmailSchema } from "../schemas.ts";
import { userResolveRateLimit } from "../rate-limiter.ts";

const Router = express.Router;

/**
 * Scans the project's CDP end users for an exact full-email match and returns
 * that user's smart account address.
 * @remarks Need-to-know by design: exact match only, and only the smart
 *   account address is extracted (never the userId, EOA, or email). `email`
 *   must be normalized (trimmed, lowercased). Returns null when no end user
 *   has this email; `address` is null when the user exists but has no EVM
 *   smart account.
 */
async function resolveSmartAccountByEmail(
  cdp: CdpClient,
  email: string,
): Promise<{ address: string | null } | null> {
  const user = await findEndUserByEmail(cdp, email);
  if (!user) return null;
  return { address: user.evmSmartAccounts?.[0] ?? null };
}

/**
 * POST /api/v1/users/resolve-email
 *
 * Checks whether an email belongs to a CDP end user and, if so, returns the
 * user's smart account address (the address an owner adds to a token's Merkle
 * editor list).
 * @remarks No listing, partial matching, or autocomplete: the requester must
 *   supply the full, exact email, and the email is never written to logs.
 *   Inviting not-yet-existing emails is a deliberate future enhancement.
 *
 * Body: { email }
 * Auth: Session token required. Rate-limited per wallet.
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
        const err = error as Error;
        console.error("[USERS] resolve-email error:", err.message);
        sendError(res, 502, "CDP_LOOKUP_FAILED", "Email lookup failed");
      }
    },
  );

  return router;
}
