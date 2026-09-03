import type { AssetUpdatePayload, Binding, NostrConfig } from "./types.ts";
import { buildBinding, verifyBinding } from "./identity.ts";
import { signAssetUpdate } from "./events.ts";
import { publishAssetUpdate } from "./publish.ts";
import { verifyAssetUpdate } from "./verify.ts";
import type { NostrEvent } from "nostr-tools";

export interface NostrFacade {
  createIdentity(): Promise<Binding>;
  verifyBinding(binding: Binding): Promise<boolean>;
  signAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): NostrEvent;
  publishAssetUpdate(binding: Binding, payload: AssetUpdatePayload, contractAddress: string): Promise<NostrEvent>;
  verifyAssetUpdate(event: NostrEvent, binding: Binding, payload: AssetUpdatePayload): Promise<boolean>;
}

export function createNostrFacade(config: NostrConfig): NostrFacade {
  return {
    createIdentity: () => buildBinding(config.signer),
    verifyBinding,
    signAssetUpdate: (b, p, a) => signAssetUpdate(b, p, a),
    publishAssetUpdate: (b, p, a) => publishAssetUpdate(b, p, a, config.relay),
    verifyAssetUpdate: (e, b, p) => verifyAssetUpdate(e, b, p, config.chain),
  };
}
