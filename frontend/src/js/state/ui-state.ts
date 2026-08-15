import { createStore } from "./create-store.ts";
import { EVENTS } from "../events/bus.js";

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
