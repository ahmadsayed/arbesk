/**
 * Domain asset store — shared state for domain/asset.js and
 * domain/collection.js. Replaces the legacy state/asset-state.js wrapper.
 * Production writes must go through the domain modules; tests may import
 * the store directly for setup/assertions.
 */
import { createStore } from "../state/create-store.ts";
import { EVENTS } from "../events/bus.ts";

export interface AssetStoreState {
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
 * Tag an in-memory manifest with the CID it represents before storing it in
 * `currentManifest`. Cache-hit checks compare `activeAssetManifestCid`
 * against `currentManifest._manifestCid` to skip an IPFS refetch, so every
 * writer of `currentManifest` must stamp the CID — this is the single
 * definition of that convention.
 */
export function tagManifestCid<T>(
  manifest: T,
  cid: string | null
): T & { _manifestCid: string | null } {
  return { ...manifest, _manifestCid: cid };
}
