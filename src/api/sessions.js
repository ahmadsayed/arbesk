/**
 * Session-based authentication for Arbesk API.
 *
 * After the first on-chain payment, the user signs a session-creation message
 * once. The backend issues an opaque session token valid for 24 hours.
 * Subsequent generation calls use that token instead of a new signature.
 *
 * The token is stored in the browser's localStorage. The only attack vector
 * is physical access to the browser — accepted as a reasonable trade-off
 * for eliminating the per-generation MetaMask pop-up.
 */

import { Router } from "express";
import crypto from "crypto";
import { web3 } from "../config.js";

// ─── Session Store ──────────────────────────────────────────────────────────

/** Map<token, { address, createdAt, expiresAt }> */
const sessions = new Map();

/** Session lifetime: 24 hours (in milliseconds) */
const SESSION_TTL = 24 * 60 * 60 * 1000;

/** Maximum age of session-creation message: 5 minutes */
const MESSAGE_MAX_AGE = 5 * 60 * 1000;

/** Clean up expired sessions every hour */
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      console.log(`[SESSION] expired — token=${token.slice(0, 8)}...`);
    }
  }
}, 60 * 60 * 1000).unref();

// ─── Session Helpers ────────────────────────────────────────────────────────

/**
 * Create a new session for the given address.
 * @param {string} address — 0x-prefixed wallet address
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
    `[SESSION] created — token=${token.slice(0, 8)}... address=${address}`,
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
    console.log(`[SESSION] not found — token=${token.slice(0, 8)}...`);
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    console.log(`[SESSION] expired — token=${token.slice(0, 8)}...`);
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
    `[SESSION] invalidated — token=${token.slice(0, 8)}... existed=${existed}`,
  );
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export default function sessionRouter() {
  const router = Router();

  /**
   * POST /api/v1/sessions
   * Create a session by signing a wallet-ownership proof message.
   *
   * Body: { message: string, signature: string }
   *   message format: "arbesk-session:<address>:<timestamp>"
   *
   * Returns: { token: string, expiresAt: number }
   */
  router.post("/", async (req, res) => {
    try {
      const { message, signature } = req.body;

      if (!message || !signature) {
        console.log("[SESSION] rejected — missing message or signature");
        return res.status(400).json({
          error: {
            code: "MISSING_PARAMS",
            message: "message and signature are required",
          },
        });
      }

      // Parse message: "arbesk-session:<address>:<timestamp>"
      const parts = message.split(":");
      if (parts.length !== 3 || parts[0] !== "arbesk-session") {
        console.log(`[SESSION] rejected — invalid message format: ${message}`);
        return res.status(400).json({
          error: {
            code: "INVALID_MESSAGE",
            message:
              'Invalid message format. Expected: "arbesk-session:<address>:<timestamp>"',
          },
        });
      }

      const claimedAddress = parts[1].toLowerCase();
      const messageTimestamp = parseInt(parts[2], 10);

      if (!claimedAddress || isNaN(messageTimestamp)) {
        console.log(
          `[SESSION] rejected — bad address or timestamp in message`,
        );
        return res.status(400).json({
          error: {
            code: "INVALID_MESSAGE",
            message: "Invalid address or timestamp in message",
          },
        });
      }

      // Verify message freshness (prevent replay of old signatures)
      const age = Date.now() - messageTimestamp;
      if (age < 0) {
        console.log(`[SESSION] rejected — future timestamp in message`);
        return res.status(400).json({
          error: {
            code: "FUTURE_TIMESTAMP",
            message: "Message timestamp is in the future",
          },
        });
      }
      if (age > MESSAGE_MAX_AGE) {
        console.log(
          `[SESSION] rejected — message too old (${(age / 1000).toFixed(0)}s)`,
        );
        return res.status(400).json({
          error: {
            code: "MESSAGE_EXPIRED",
            message: "Session creation message is too old. Please try again.",
          },
        });
      }

      // Recover address from signature
      let recoveredAddress;
      try {
        recoveredAddress = (
          await web3.eth.accounts.recover(message, signature)
        ).toLowerCase();
      } catch (e) {
        console.log(`[SESSION] rejected — signature recovery failed: ${e.message}`);
        return res.status(400).json({
          error: {
            code: "SIGNATURE_INVALID",
            message: "Failed to recover address from signature",
          },
        });
      }

      if (recoveredAddress !== claimedAddress) {
        console.log(
          `[SESSION] rejected — address mismatch: claimed=${claimedAddress} recovered=${recoveredAddress}`,
        );
        return res.status(403).json({
          error: {
            code: "ADDRESS_MISMATCH",
            message: "Signature does not match the claimed address",
          },
        });
      }

      console.log(`[SESSION] recovered address=${recoveredAddress}`);

      // Create session
      const token = createSession(recoveredAddress);
      const expiresAt = sessions.get(token).expiresAt;

      res.status(201).json({ token, expiresAt });
    } catch (error) {
      console.error("[SESSION] error:", error.message);
      res.status(500).json({
        error: {
          code: "SESSION_CREATION_FAILED",
          message: error.message,
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
