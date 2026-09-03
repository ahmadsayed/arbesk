import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding, ChainReadPort } from "./types.ts";
import { verifyEventSignature } from "./events.ts";
import { verifyBinding } from "./identity.ts";

/** Verifies an update event end-to-end: sig → binding → on-chain authorization. */
export async function verifyAssetUpdate(
  event: NostrEvent,
  binding: Binding,
  payload: AssetUpdatePayload,
  chain: ChainReadPort
): Promise<boolean> {
  if (!verifyEventSignature(event)) return false;
  if (event.pubkey !== binding.pubkey) return false;
  if (!(await verifyBinding(binding))) return false;
  return chain.isTokenAuthor(payload.chainId, payload.tokenId, binding.address);
}
