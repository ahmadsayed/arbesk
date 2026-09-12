/**
 * Hono session-auth middleware — port of src/api/authentication.ts.
 * @remarks Accepts only `Authorization: Session <token>`; the opaque token is
 *   created by POST /api/v1/sessions after a SIWE (EIP-4361) signature and is
 *   valid for 24 hours.
 */

import type { MiddlewareHandler } from "hono";
import { validateSession } from "../api/sessions.ts";
import { sendError } from "./json-error.ts";

export interface AuthVariables {
  userAddress: string;
  txHash: string | null;
}

/**
 * Hono middleware validating `Authorization: Session <token>` and exposing
 * the wallet address as `c.get("userAddress")`.
 */
const authorize: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  try {
    const authHeader = c.req.header("authorization");
    if (!authHeader) {
      console.log(`[AUTH] rejected - missing Authorization header`);
      return sendError(c, 401, "MISSING_AUTH", "Missing Authorization header");
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "session") {
      console.log(`[AUTH] rejected - invalid format or scheme`);
      return sendError(
        c,
        401,
        "INVALID_AUTH_FORMAT",
        "Invalid Authorization format. Expected: Session <token>",
      );
    }

    const token = parts[1];
    const address = validateSession(token);

    if (!address) {
      console.log(`[AUTH] rejected - invalid or expired session token`);
      return sendError(
        c,
        401,
        "INVALID_SESSION",
        "Session token is invalid or expired. Create a new session by signing again.",
      );
    }

    c.set("userAddress", address);
    c.set("txHash", null);
    console.log(`[AUTH] session valid - address=${address}`);
    return await next();
  } catch (error) {
    const err = error as Error;
    console.error("[AUTH] error:", err.message);
    return sendError(c, 403, "AUTH_FAILED", "Authentication failed: " + err.message);
  }
};

export default authorize;
