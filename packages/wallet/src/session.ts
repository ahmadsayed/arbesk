/**
 * Session store — the environment seam for opaque wallet-bound session tokens.
 * Used by the backend (in-memory), the browser (localStorage-backed), and
 * tests (fixed clock).
 */
import type { SessionStore } from "./types.ts";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface MemorySessionStoreOptions {
  /** Session lifetime in ms. Default 24h. */
  ttlMs?: number;
  /** Clock (test seam). */
  now?: () => number;
  /** Token generator (test seam). Default globalThis.crypto.randomUUID. */
  tokenFactory?: () => string;
}

interface SessionRecord {
  address: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Creates an in-memory SessionStore with hourly expiry cleanup.
 */
export function createMemorySessionStore(
  opts: MemorySessionStoreOptions = {},
): SessionStore {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;
  const tokenFactory =
    opts.tokenFactory ?? (() => globalThis.crypto.randomUUID());

  const sessions = new Map<string, SessionRecord>();

  // Clean up expired sessions hourly.
  const timer = setInterval(() => {
    const t = now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= t) sessions.delete(token);
    }
  }, 60 * 60 * 1000);
  // Don't keep the process alive in Node; no-op in the browser.
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    create(address) {
      const token = tokenFactory();
      const createdAt = now();
      const expiresAt = createdAt + ttlMs;
      sessions.set(token, {
        address: address.toLowerCase(),
        createdAt,
        expiresAt,
      });
      return { token, expiresAt };
    },
    validate(token) {
      const session = sessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= now()) {
        sessions.delete(token);
        return null;
      }
      return session.address;
    },
    invalidate(token) {
      sessions.delete(token);
    },
  };
}
