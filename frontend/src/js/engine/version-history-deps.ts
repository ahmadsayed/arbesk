/**
 * Browser wiring for the asset-core version-history store.
 *
 * The store lives in asset-core (environment-agnostic) and exposes a `_deps`
 * seam; this module installs the engine/wallet-backed implementations that
 * used to be dynamic imports inside the store. Imported for its side effect
 * from app-init.ts before any scene/history events can fire.
 */
import { configureVersionHistoryDeps } from "@arbesk/asset-core/domain/version-history-store.js";
import { walkManifestChain } from "./time-travel.ts";
import { clearScene, loadAssetManifest } from "./scene-graph.ts";
import { getActiveContract } from "../blockchain/wallet.ts";

configureVersionHistoryDeps({
  walkChain: (cid) => walkManifestChain(cid),
  clearScene: async () => {
    clearScene();
  },
  loadAssetManifest: (cid) => loadAssetManifest(cid),
  fetchPublishedCid: async (tokenId) => {
    const contract = getActiveContract();
    if (!contract) return null;
    const cid = await contract.methods.tokenURI(tokenId).call();
    return cid || null;
  },
});
