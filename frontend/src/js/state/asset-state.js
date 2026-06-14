import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  activeAssetManifestCid: null,
  activeAssetTokenId: null,
  activeAssetName: null,
  latestAssetManifestCid: null,
  currentManifest: null,
};

const _state = { ..._defaults };

export const assetState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.ASSET_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.ASSET_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
