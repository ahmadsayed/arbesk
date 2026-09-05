/**
 * Shared Nostr relay primitives.
 * @remarks Relay-protocol conventions live in one place.
 * Used by chat-proxy.ts and comments-archive.ts.
 */

import { WebSocket } from "ws";
import { finalizeEvent, Relay, utils } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";

/** Nostr kind for Arbesk asset chat/comment events. */
export const KIND_CHAT = 1;

/** Tag name used to scope events to a canonical asset id (`#asset`). */
export const TAG_ASSET = "asset";

/** Nostr kind for asset-update notifications (never reuse kind 1 = chat). */
export const KIND_ASSET_UPDATE = 20001;

/** Tag name for the token-scoped key "<chainId>:<contract>:<tokenId>". */
export const TAG_TOKEN = "token";

/** BigInt-safe token id normalization so "0x2a" and "42" produce one tag. */
function normalizeTokenId(id: string): string {
  try {
    return BigInt(id).toString();
  } catch {
    return String(id);
  }
}

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
 * Builds a signed KIND_ASSET_UPDATE event for a token whose on-chain URI just
 * changed. Signed with the given service key so the browser can trust it.
 */
export function buildAssetUpdateEvent(
  privkeyHex: string,
  payload: { chainId: number; contractAddress: string; tokenId: string; newAssetURI: string; assetId?: string | null },
): NostrEvent {
  const tokenTag = `${payload.chainId}:${payload.contractAddress.toLowerCase()}:${normalizeTokenId(payload.tokenId)}`;
  return finalizeEvent(
    {
      kind: KIND_ASSET_UPDATE,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ ...payload, assetId: payload.assetId ?? null }),
      tags: [[TAG_TOKEN, tokenTag]],
    },
    utils.hexToBytes(privkeyHex),
  );
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
