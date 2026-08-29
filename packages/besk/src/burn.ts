/**
 * Burn a collection token and unpin its IPFS footprint — mirrors the Studio
 * flow (frontend/src/js/blockchain/wallet-publishing.ts): unpin best-effort
 * BEFORE the burn (the backend's unpin endpoint verifies on-chain ownership,
 * so the token must still be live), then relay the burn. Owner-only, like all
 * CLI writes (proof: []).
 */
import { unpinCids } from "./adapters.ts";
import { clearCatalogCache, getCollectionManifest } from "./catalog.ts";
import { relay } from "./relay.ts";
import { setActiveCollection } from "./session.ts";
import type { Session } from "./session.ts";

export async function burnCollection(
  session: Session,
  tokenId: string,
): Promise<Record<string, unknown>> {
  try {
    const { cid } = await getCollectionManifest(tokenId);
    const result = await unpinCids(session, cid, tokenId);
    console.log("Unpinned " + result.count + " CIDs");
    if (result.errors?.length) console.warn("Unpin errors:", result.errors);
  } catch (e) {
    console.warn("Unpin failed (non-fatal):", (e as Error).message);
  }

  const receipt = await relay(session, "burn", tokenId, { proof: [] });
  clearCatalogCache();
  if (session.activeCollectionTokenId === tokenId) setActiveCollection(null);
  return receipt;
}
