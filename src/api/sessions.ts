/**
 * Session-based authentication for the Arbesk API.
 * @remarks A one-time SIWE (EIP-4361) signature mints an opaque 24-hour token
 *   that replaces per-generation signatures. The token lives in browser
 *   localStorage; the accepted trade-off is physical browser access versus
 *   eliminating the per-generation MetaMask pop-up.
 */

import { Hono } from "hono";
import crypto from "crypto";
import { verifyProof } from "./identity.ts";
import { validateBody } from "./validation.ts";
import { createSessionSchema } from "./schemas.ts";
import { classifySignin, recordSignin } from "./signin-stats.ts";

// ─── Session Store ──────────────────────────────────────────────────────────

interface SessionRecord {
  address: string;
  /** CDP end-user id (server-wallet sessions only). */
  userId?: string | null;
  /** Login email (email-auth sessions only). */
  email?: string | null;
  /** How this session was established. */
  authMethod?: "email" | "siwe" | null;
  createdAt: number;
  expiresAt: number;
}

export interface SessionMeta {
  userId?: string | null;
  email?: string | null;
  authMethod?: "email" | "siwe";
}

/** Map<token, SessionRecord> */
const sessions = new Map<string, SessionRecord>();

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
 * @param address - 0x-prefixed wallet address
 * @returns opaque session token
 */
function createSession(address: string, meta: SessionMeta = {}): string {
  const token = crypto.randomUUID();
  const now = Date.now();
  sessions.set(token, {
    address: address.toLowerCase(),
    userId: meta.userId ?? null,
    email: meta.email ?? null,
    authMethod: meta.authMethod ?? null,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
  });
  console.log(
    `[SESSION] created - token=${token.slice(0, 8)}... address=${address}`,
  );
  return token;
}

/** Return the full session record, or null if missing/expired. */
function getSessionRecord(token: string): SessionRecord | null {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Validate a session token and return the associated address.
 * @returns address if valid, null if expired or not found
 */
function validateSession(token: string): string | null {
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
 */
function invalidateSession(token: string): void {
  const existed = sessions.delete(token);
  console.log(
    `[SESSION] invalidated - token=${token.slice(0, 8)}... existed=${existed}`,
  );
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export default function sessionRouter() {
  const app = new Hono();

  /**
   * POST /api/v1/sessions
   * Create a session by proving identity. Wallet logins prove ownership via
   * SIWE (EIP-4361); future OAuth/OIDC logins prove identity via an ID token.
   *
   * Body: { proof: { kind: "siwe", message, signature, eoaAddress? }
   *              | { kind: "oidc", provider, idToken, nonce? } }
   * Returns: { token: string, expiresAt: number }
   */
  app.post("/", validateBody(createSessionSchema), async (c) => {
    try {
      const { proof } = c.req.valid("json");

      const result = await verifyProof(proof, {
        expectedDomain: c.req.header("host"),
      });

      if (!result.valid) {
        console.log(`[SESSION] rejected proof - ${result.error}`);
        return c.json(
          {
            error: {
              code: "INVALID_PROOF",
              message: result.error,
            },
          },
          400,
        );
      }

      console.log(`[SESSION] verified proof - address=${result.address}`);

      if (!result.address) {
        throw new Error("Authentication verification returned no address");
      }

      // Create session
      const token = createSession(result.address);
      recordSignin(result.address, proof.kind === "siwe" ? classifySignin(result.address, proof) : "wallet");
      const expiresAt = sessions.get(token)!.expiresAt;

      return c.json({ token, expiresAt }, 201);
    } catch (error) {
      const err = error as Error;
      console.error("[SESSION] error:", err.message);
      return c.json(
        {
          error: {
            code: "SESSION_CREATION_FAILED",
            message: err.message,
          },
        },
        500,
      );
    }
  });

  /**
   * DELETE /api/v1/sessions
   * Invalidate the current session (logout).
   *
   * Header: Authorization: Session <token>
   */
  app.delete("/", (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Session ")) {
      return c.json(
        {
          error: {
            code: "MISSING_SESSION",
            message: "Session token required to delete session",
          },
        },
        401,
      );
    }

    const token = authHeader.slice(8); // remove "Session " prefix
    invalidateSession(token);
    return c.json({ invalidated: true });
  });

  return app;
}

// Export helpers for use by authentication middleware and tests
export { validateSession, invalidateSession, getSessionRecord, createSession, sessions };
