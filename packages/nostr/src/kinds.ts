/** Nostr kind for asset-update notifications (never reuse kind 1 = chat). */
export const KIND_ASSET_UPDATE = 20001;
/** Tag name for the token-scoped key "<chainId>:<contract>:<tokenId>". */
export const TAG_TOKEN = "token";
/** Fixed message the wallet signs to derive the Nostr signing key. */
export const IDENTITY_MESSAGE = "arbesk-nostr-identity-v1";
