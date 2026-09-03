/** Nostr kind for asset-update notifications (never reuse kind 1 = chat). */
export const KIND_ASSET_UPDATE = 20001;
/** Nostr kind for the wallet↔Nostr identity binding. */
export const KIND_BINDING = 10050;
/** Tag name for the token-scoped key "<chainId>:<contract>:<tokenId>". */
export const TAG_TOKEN = "token";
/** Tag name for the binding's wallet address. */
export const TAG_ADDRESS = "address";
/** Fixed message the wallet signs to derive the Nostr key and prove ownership. */
export const IDENTITY_MESSAGE = "arbesk-nostr-identity-v1";
