/**
 * Domain asset store — shared state for domain/asset.js and
 * domain/collection.js. Replaces the legacy state/asset-state.js wrapper.
 * Production writes must go through the domain modules; tests may import
 * the store directly for setup/assertions.
 */
import { createStore } from "../state/create-store.js";
import { EVENTS } from "../events/bus.js";

/**
 * @typedef {Object} AssetStoreState
 * @property {string|null} activeAssetManifestCid
 * @property {string|null} activeAssetTokenId
 * @property {string|null} activeAssetName
 * @property {string|null} latestAssetManifestCid
 * @property {any} currentManifest
 * @property {string|null} activeCollectionTokenId
 * @property {string|null} activeAssetId
 * @property {string|null} selectedCollectionId
 */

const { store: assetStore, _resetForTesting } = createStore(
  /** @type {AssetStoreState} */ ({
    activeAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetName: null,
    latestAssetManifestCid: null,
    currentManifest: null,
    activeCollectionTokenId: null,
    activeAssetId: null,
    selectedCollectionId: null,
  }),
  EVENTS.ASSET_STATE_CHANGED
);

export { assetStore, _resetForTesting };

/**
 * Tag an in-memory manifest with the CID it represents before storing it in
 * `currentManifest`. Cache-hit checks compare `activeAssetManifestCid`
 * against `currentManifest._manifestCid` to skip an IPFS refetch, so every
 * writer of `currentManifest` must stamp the CID — this is the single
 * definition of that convention.
 * @template T
 * @param {T} manifest
 * @param {string|null} cid
 * @returns {T & { _manifestCid: string|null }}
 */
export function tagManifestCid(manifest, cid) {
  return { ...manifest, _manifestCid: cid };
}
