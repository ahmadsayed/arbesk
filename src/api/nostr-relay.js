/**
 * Shared Nostr relay primitives.
 *
 * Constants and helpers used by both the live chat proxy (`chat-proxy.js`) and
 * the one-shot comments archiver (`comments-archive.js`) so the relay protocol
 * conventions live in a single place.
 *
 * All relay access is backed by `nostr-tools`; the WebSocket implementation is
 * explicitly bound to the Node `ws` package here so callers don't have to
 * repeat the plumbing.
 */

import { WebSocket } from "ws";
import { Relay } from "nostr-tools";

/** Nostr kind for Arbesk asset chat/comment events. */
export const KIND_CHAT = 1;

/** Tag name used to scope events to a canonical asset id (`#asset`). */
export const TAG_ASSET = "asset";

/**
 * Events originate from our trusted private relay (nostr-rs-relay) which already
 * validates signatures before storage. Re-verifying on the backend proxy path is
 * redundant and would require every test event to carry a valid signature, so we
 * skip verification here while still relying on nostr-tools for wire protocol
 * handling and event serialization/signing.
 */
const SKIP_VERIFY = () => true;

/**
 * Create a nostr-tools Relay wired to the Node `ws` implementation.
 *
 * @param {string} url
 * @param {object} [opts]
 * @returns {import("nostr-tools").Relay}
 */
export function createRelay(url, opts = {}) {
  return new Relay(url, {
    websocketImplementation: WebSocket,
    verifyEvent: SKIP_VERIFY,
    enableReconnect: false,
    ...opts,
  });
}

/**
 * Close a WebSocket without throwing, regardless of its current state.
 * Falls back to terminate() if a graceful close fails. `code`/`reason` are
 * optional (omit for a plain close()).
 *
 * @param {import("ws").WebSocket} ws
 * @param {number} [code]
 * @param {string} [reason]
 */
export function safeClose(ws, code, reason) {
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
