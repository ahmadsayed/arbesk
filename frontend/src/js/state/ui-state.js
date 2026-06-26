// @ts-nocheck
import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

const _defaults = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const { store: uiState, _resetForTesting } = createStore(_defaults, EVENTS.UI_STATE_CHANGED);
export { uiState, _resetForTesting };
