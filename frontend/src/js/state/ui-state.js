import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const _state = { ..._defaults };

export const uiState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.UI_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.UI_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
