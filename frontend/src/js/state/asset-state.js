// @ts-nocheck
import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

const { store: assetState, _resetForTesting } = createStore(
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
export { assetState, _resetForTesting };

/**
 * Tag an in-memory manifest with the CID it represents before storing it in
 * `currentManifest`. Cache-hit checks compare `activeAssetManifestCid` against
 * `currentManifest._manifestCid` to skip an IPFS refetch, so every writer of
 * `currentManifest` must stamp the CID — this is the single definition of that
 * convention.
 * @template T
 * @param {T} manifest
 * @param {string|null} cid
 * @returns {T & { _manifestCid: string|null }}
 */
export function tagManifestCid(manifest, cid) {
  return { ...manifest, _manifestCid: cid };
}
