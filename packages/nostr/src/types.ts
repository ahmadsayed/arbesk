import type { NostrEvent } from "nostr-tools";

/** Signs an EIP-191 personal_sign message, returning the hex signature. */
export interface WalletSignPort {
  signMessage(message: string): Promise<string>;
}

/** Publishes a signed Nostr event to a relay. */
export interface RelayPort {
  publish(event: NostrEvent): Promise<void>;
}

/** The wallet-signature key material used to sign update events. */
export interface Binding {
  signature: string;
}

/** Payload carried by a KIND_ASSET_UPDATE event. */
export interface AssetUpdatePayload {
  chainId: number;
  tokenId: string;
  newAssetURI: string;
  assetId?: string;
}

export interface NostrConfig {
  signer: WalletSignPort;
  relay: RelayPort;
}
