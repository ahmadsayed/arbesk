/**
 * Arbesk API Authentication Middleware
 *
 * Accepts only:
 *   Authorization: Session <token>
 *
 * The session token is created by POST /api/v1/sessions after the user
 * signs a SIWE (EIP-4361) message. The opaque token is valid for 24 hours.
 */

import { validateSession } from "./sessions.js";

/**
 * @param {import('express').Request} request
 * @param {import('express').Response} response
 * @param {import('express').NextFunction} next
 */
export default async function authorize(request, response, next) {
  try {
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      console.log(`[AUTH] rejected - missing Authorization header`);
      return response.status(401).json({
        error: {
          code: "MISSING_AUTH",
          message: "Missing Authorization header",
        },
      });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "session") {
      console.log(`[AUTH] rejected - invalid format or scheme`);
      return response.status(401).json({
        error: {
          code: "INVALID_AUTH_FORMAT",
          message: "Invalid Authorization format. Expected: Session <token>",
        },
      });
    }

    const token = parts[1];
    const address = validateSession(token);

    if (!address) {
      console.log(`[AUTH] rejected - invalid or expired session token`);
      return response.status(401).json({
        error: {
          code: "INVALID_SESSION",
          message:
            "Session token is invalid or expired. Create a new session by signing again.",
        },
      });
    }

    response.locals.userAddress = address;
    response.locals.txHash = null;
    console.log(`[AUTH] session valid - address=${address}`);
    return next();
  } catch (error) {
    const err = /** @type {Error} */ (error);
    console.error("[AUTH] error:", err.message);
    return response.status(403).json({
      error: {
        code: "AUTH_FAILED",
        message: "Authentication failed: " + err.message,
      },
    });
  }
}
