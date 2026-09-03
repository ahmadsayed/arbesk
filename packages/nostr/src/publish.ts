import type { NostrEvent } from "nostr-tools";
import type { AssetUpdatePayload, Binding, RelayPort } from "./types.ts";
import { signAssetUpdate } from "./events.ts";

/** Signs and publishes an asset-update event to the relay. */
export async function publishAssetUpdate(
  binding: Binding,
  payload: AssetUpdatePayload,
  contractAddress: string,
  relay: RelayPort
): Promise<NostrEvent> {
  const event = signAssetUpdate(binding, payload, contractAddress);
  await relay.publish(event);
  return event;
}
