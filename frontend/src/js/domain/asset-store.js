// @ts-nocheck
/**
 * Domain asset store — private shared state for domain/asset.js and
 * domain/collection.js. Replaces the legacy state/asset-state.js wrapper.
 */
import { createStore } from "../state/create-store.js";
import { EVENTS } from "../events/bus.js";

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
  },
  EVENTS.ASSET_STATE_CHANGED
);

export { assetStore, _resetForTesting };

/**
 * Tag an in-memory manifest with the CID it represents before storing it in
 * `currentManifest`.
 * @template T
 * @param {T} manifest
 * @param {string|null} cid
 * @returns {T & { _manifestCid: string|null }}
 */
export function tagManifestCid(manifest, cid) {
  return { ...manifest, _manifestCid: cid };
}
