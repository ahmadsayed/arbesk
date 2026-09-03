import { finalizeEvent, verifyEvent } from "nostr-tools";
import { hexToBytes } from "viem";
import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding } from "./types.ts";
import { KIND_ASSET_UPDATE, TAG_TOKEN } from "./kinds.ts";
import { deriveSecretKey } from "./identity.ts";

/** Canonical token-scoped tag "<chainId>:<contract>:<tokenId>". */
export function tokenTag(chainId: number, contractAddress: string, tokenId: string): string {
  return `${chainId}:${contractAddress.toLowerCase()}:${tokenId}`;
}

/** Signs a KIND_ASSET_UPDATE event with the key derived from the binding. */
export function signAssetUpdate(
  binding: Binding,
  payload: AssetUpdatePayload,
  contractAddress: string
): NostrEvent {
  const content = JSON.stringify({
    chainId: payload.chainId,
    contractAddress,
    tokenId: payload.tokenId,
    newAssetURI: payload.newAssetURI,
    assetId: payload.assetId ?? null,
  });
  return finalizeEvent(
    {
      kind: KIND_ASSET_UPDATE,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [[TAG_TOKEN, tokenTag(payload.chainId, contractAddress, payload.tokenId)]],
    },
    hexToBytes(`0x${deriveSecretKey(binding.signature)}`)
  );
}

/**
 * Verifies an event's Schnorr signature.
 *
 * nostr-tools memoizes its verdict on a symbol-keyed `verifiedSymbol`
 * property that `finalizeEvent` stamps onto the event it returns. A tampered
 * event built via object spread carries that cached flag over, so
 * `verifyEvent` would short-circuit and wrongly accept it. Rebuilding a
 * plain object from the wire fields drops the memo and forces a real check.
 */
export function verifyEventSignature(event: NostrEvent): boolean {
  try {
    return verifyEvent({
      id: event.id,
      sig: event.sig,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
    });
  } catch {
    return false;
  }
}
