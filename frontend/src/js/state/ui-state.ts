import { createStore } from "@arbesk/asset-core/state/create-store.js";
import { EVENTS } from "@arbesk/asset-core/events/bus.js";

interface UiState {
  selectedNodeId: string | null;
  nestingDepth: number;
}

const _defaults: UiState = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const { store: uiState, _resetForTesting } = createStore(_defaults, EVENTS.UI_STATE_CHANGED);
export { uiState, _resetForTesting };
