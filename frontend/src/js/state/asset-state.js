import { createStore } from "./create-store.js";
import { EVENTS } from "../events/registry.js";

const _defaults = {
  activeAssetManifestCid: null,
  activeAssetTokenId: null,
  activeAssetName: null,
  latestAssetManifestCid: null,
  currentManifest: null,
};

const { store: assetState, _resetForTesting } = createStore(_defaults, EVENTS.ASSET_STATE_CHANGED);
export { assetState, _resetForTesting };
