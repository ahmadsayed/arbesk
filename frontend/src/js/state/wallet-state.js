import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  walletAddress: null,
  chainId: null,
  contract: null,
  contractAddress: null,
};

const _state = { ..._defaults };

export const walletState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.WALLET_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.WALLET_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
