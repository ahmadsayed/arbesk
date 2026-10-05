/**
 * Installs the browser wiring for the asset-core version-history store.
 * @remarks The store exposes a `_deps` seam for environment-specific
 *   implementations; this module provides the engine/wallet-backed ones.
 * Used by app-init.ts (side-effect import, before any scene/history events).
 */
import { configureVersionHistoryDeps } from "@arbesk/asset-core/domain/version-history-store.js";
import { getActiveAssetId } from "@arbesk/asset-core/domain/asset.js";
import { walkManifestChain } from "./time-travel.ts";
import { clearScene, loadAssetManifest } from "./scene-graph.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { getActiveContract } from "../blockchain/wallet.ts";
import { getReadableContract } from "../blockchain/read-contract.ts";

/**
 * Picks the asset manifest CID behind a tokenURI payload.
 * @remarks tokenURI returns the COLLECTION manifest CID; the version chain's
 *   entries are asset manifest CIDs, so the published marker needs the
 *   collection → asset indirection resolved. Legacy tokens whose tokenURI is
 *   an asset manifest pass through unchanged.
 */
export function assetCidFromTokenUriManifest(
  manifest: any,
  tokenUriCid: string,
  assetId: string | null
): string | null {
  if (manifest?.type !== "collection") return tokenUriCid;
  if (!assetId) return null;
  return manifest.assets?.[assetId] ?? null;
}

async function resolvePublishedAssetCid(
  tokenUriCid: string
): Promise<string | null> {
  try {
    const manifest = await getFromRemoteIPFS(tokenUriCid);
    return assetCidFromTokenUriManifest(manifest, tokenUriCid, getActiveAssetId());
  } catch {
    return tokenUriCid;
  }
}

configureVersionHistoryDeps({
  walkChain: (cid) => walkManifestChain(cid),
  clearScene: async () => {
    clearScene();
  },
  loadAssetManifest: (cid) => loadAssetManifest(cid),
  fetchPublishedCid: async (tokenId) => {
    // Read path — anonymous viewers (public profiles) use the read-only
    // fallback contract for the tokenURI read.
    const contract = getActiveContract() || (await getReadableContract());
    if (!contract) return null;
    const cid = await contract.read.tokenURI([BigInt(tokenId)]);
    return cid ? resolvePublishedAssetCid(cid) : null;
  },
});
