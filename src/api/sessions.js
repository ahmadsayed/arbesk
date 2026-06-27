/**
 * Session-based authentication for Arbesk API.
 *
 * Uses SIWE (EIP-4361) for wallet ownership proof.
 * The user signs a standard SIWE message once, the backend verifies it,
 * and issues an opaque session token valid for 24 hours.
 * Subsequent generation calls use that token instead of a new signature.
 *
 * The token is stored in the browser's localStorage. The only attack vector
 * is physical access to the browser - accepted as a reasonable trade-off
 * for eliminating the per-generation MetaMask pop-up.
 */

import express from "express";
import crypto from "crypto";
import { web3 } from "../config.js";
import { verifySiwe } from "./siwe-verify.js";

const Router = express.Router;

// ─── Session Store ──────────────────────────────────────────────────────────

/** Map<token, { address, createdAt, expiresAt }> */
const sessions = new Map();

/** Session lifetime: 24 hours (in milliseconds) */
const SESSION_TTL = 24 * 60 * 60 * 1000;

/** Clean up expired sessions every hour */
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      console.log(`[SESSION] expired - token=${token.slice(0, 8)}...`);
    }
  }
}, 60 * 60 * 1000).unref();

// ─── Session Helpers ────────────────────────────────────────────────────────

/**
 * Create a new session for the given address.
 * @param {string} address - 0x-prefixed wallet address
 * @returns {string} opaque session token
 */
function createSession(address) {
  const token = crypto.randomUUID();
  const now = Date.now();
  sessions.set(token, {
    address: address.toLowerCase(),
    createdAt: now,
    expiresAt: now + SESSION_TTL,
  });
  console.log(
    `[SESSION] created - token=${token.slice(0, 8)}... address=${address}`,
  );
  return token;
}

/**
 * Validate a session token and return the associated address.
 * @param {string} token
 * @returns {string|null} address if valid, null if expired or not found
 */
function validateSession(token) {
  const session = sessions.get(token);
  if (!session) {
    console.log(`[SESSION] not found - token=${token.slice(0, 8)}...`);
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    console.log(`[SESSION] expired - token=${token.slice(0, 8)}...`);
    return null;
  }
  return session.address;
}

/**
 * Invalidate (delete) a session token.
 * @param {string} token
 */
function invalidateSession(token) {
  const existed = sessions.delete(token);
  console.log(
    `[SESSION] invalidated - token=${token.slice(0, 8)}... existed=${existed}`,
  );
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export default function sessionRouter() {
  const router = Router();

  /**
   * POST /api/v1/sessions
   * Create a session by signing a SIWE (EIP-4361) message.
   *
   * Body: { message: string, signature: string }
   *   message: standard SIWE format
   *
   * Returns: { token: string, expiresAt: number }
   */
  router.post("/", async (req, res) => {
    try {
      const { message, signature } = req.body;

      if (!message || !signature) {
        console.log("[SESSION] rejected - missing message or signature");
        return res.status(400).json({
          error: {
            code: "MISSING_PARAMS",
            message: "message and signature are required",
          },
        });
      }

      // Verify SIWE message
      const result = await verifySiwe(message, signature, {
        expectedDomain: req.headers.host,
      });

      if (!result.valid) {
        console.log(`[SESSION] rejected - ${result.error}`);
        return res.status(400).json({
          error: {
            code: "INVALID_SIWE",
            message: result.error,
          },
        });
      }

      console.log(`[SESSION] verified SIWE - address=${result.address}`);

      if (!result.address) {
        throw new Error("SIWE verification returned no address");
      }

      // Create session
      const token = createSession(result.address);
      const expiresAt = sessions.get(token).expiresAt;

      res.status(201).json({ token, expiresAt });
    } catch (error) {
      const err = /** @type {Error} */ (error);
      console.error("[SESSION] error:", err.message);
      res.status(500).json({
        error: {
          code: "SESSION_CREATION_FAILED",
          message: err.message,
        },
      });
    }
  });

  /**
   * DELETE /api/v1/sessions
   * Invalidate the current session (logout).
   *
   * Header: Authorization: Session <token>
   */
  router.delete("/", (req, res) => {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Session ")) {
      return res.status(401).json({
        error: {
          code: "MISSING_SESSION",
          message: "Session token required to delete session",
        },
      });
    }

    const token = authHeader.slice(8); // remove "Session " prefix
    invalidateSession(token);
    res.json({ invalidated: true });
  });

  return router;
}

// Export helpers for use by authentication middleware and tests
export { validateSession, invalidateSession, createSession, sessions };
