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
