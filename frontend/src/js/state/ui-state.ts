import { createStore } from "../asset-core/state/create-store.ts";
import { EVENTS } from "../asset-core/events/bus.ts";

export interface UiState {
  selectedNodeId: string | null;
  nestingDepth: number;
}

const _defaults: UiState = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const { store: uiState, _resetForTesting } = createStore(_defaults, EVENTS.UI_STATE_CHANGED);
export { uiState, _resetForTesting };
