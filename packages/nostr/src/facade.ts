import type { AssetUpdatePayload, Binding, NostrConfig } from "./types.ts";
import { buildBinding } from "./identity.ts";
import { signAssetUpdate } from "./events.ts";
import { publishAssetUpdate } from "./publish.ts";
import type { NostrEvent } from "nostr-tools";

export interface NostrFacade {
  createIdentity(): Promise<Binding>;
  signAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): NostrEvent;
  publishAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): Promise<NostrEvent>;
}

export function createNostrFacade(config: NostrConfig): NostrFacade {
  return {
    createIdentity: () => buildBinding(config.signer),
    signAssetUpdate: (b, p, a) => signAssetUpdate(b, p, a),
    publishAssetUpdate: (b, p, a) => publishAssetUpdate(b, p, a, config.relay),
  };
}
