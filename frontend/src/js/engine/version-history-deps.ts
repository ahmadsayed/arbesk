/**
 * Installs the browser wiring for the asset-core version-history store.
 * @remarks The store exposes a `_deps` seam for environment-specific
 *   implementations; this module provides the engine/wallet-backed ones.
 * Used by app-init.ts (side-effect import, before any scene/history events).
 */
import { configureVersionHistoryDeps } from "@arbesk/asset-core/domain/version-history-store.js";
import { walkManifestChain } from "./time-travel.ts";
import { clearScene, loadAssetManifest } from "./scene-graph.ts";
import { getActiveContract } from "../blockchain/wallet.ts";
import { getReadableContract } from "../blockchain/read-contract.ts";

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
    return cid || null;
  },
});
