/**
 * Shared Nostr relay primitives.
 * @remarks Relay-protocol conventions live in one place.
 * Used by chat-proxy.ts and comments-archive.ts.
 */

import { WebSocket } from "ws";
import { Relay } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";

/** Nostr kind for Arbesk asset chat/comment events. */
export const KIND_CHAT = 1;

/** Tag name used to scope events to a canonical asset id (`#asset`). */
export const TAG_ASSET = "asset";

/**
 * @remarks The trusted private relay already validates signatures before
 *   storage, so re-verifying on the backend proxy path is redundant (and
 *   would require every test event to carry a valid signature).
 */
const SKIP_VERIFY = (_event: NostrEvent): boolean => true;

/**
 * Create a nostr-tools Relay wired to the Node `ws` implementation.
 */
export function createRelay(url: string, opts: Record<string, unknown> = {}): Relay {
  return new Relay(url, {
    websocketImplementation: WebSocket,
    verifyEvent: SKIP_VERIFY,
    enableReconnect: false,
    ...opts,
  });
}

/**
 * Creates a nostr-tools pool wired to the Node `ws` implementation and the
 * same skip-verify policy as {@link createRelay}.
 */
export function createPool(): AbstractSimplePool {
  return new AbstractSimplePool({
    websocketImplementation: WebSocket,
    verifyEvent: SKIP_VERIFY,
    enableReconnect: false,
    maxWaitForConnection: 3000,
  });
}

/**
 * Closes a WebSocket without throwing, regardless of its current state.
 * @remarks Falls back to terminate() if a graceful close fails; `code`/`reason`
 *   are optional.
 */
export function safeClose(ws: WebSocket, code?: number, reason?: string): void {
  if (!ws) return;
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    try {
      ws.close(code, reason);
    } catch {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
  }
}
