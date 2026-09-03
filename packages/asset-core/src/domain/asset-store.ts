/**
 * Domain asset store — shared state for domain/asset.ts and domain/collection.ts.
 * @remarks Production writes must go through the domain modules.
 */
import { createStore } from "../state/create-store.ts";
import { EVENTS } from "../events/bus.ts";

interface AssetStoreState {
  activeAssetManifestCid: string | null;
  activeAssetTokenId: string | null;
  activeAssetName: string | null;
  latestAssetManifestCid: string | null;
  currentManifest: any;
  activeCollectionTokenId: string | null;
  activeAssetId: string | null;
  selectedCollectionId: string | null;
}

const { store: assetStore, _resetForTesting } = createStore(
  {
    activeAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetName: null,
    latestAssetManifestCid: null,
    currentManifest: null,
    activeCollectionTokenId: null,
    activeAssetId: null,
    selectedCollectionId: null,
  } as AssetStoreState,
  EVENTS.ASSET_STATE_CHANGED
);

export { assetStore, _resetForTesting };

/**
 * Tags an in-memory manifest with the CID it represents.
 * @remarks Every writer of `currentManifest` must stamp the CID so cache-hit
 *   checks can skip an IPFS refetch; this is the single definition of that
 *   convention.
 */
export function tagManifestCid<T>(
  manifest: T,
  cid: string | null
): T & { _manifestCid: string | null } {
  return { ...manifest, _manifestCid: cid };
}
