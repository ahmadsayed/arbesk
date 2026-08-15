import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

/**
 * @typedef {Object} UiState
 * @property {string|null} selectedNodeId
 * @property {number} nestingDepth
 */

/** @type {UiState} */
const _defaults = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const { store: uiState, _resetForTesting } = createStore(_defaults, EVENTS.UI_STATE_CHANGED);
export { uiState, _resetForTesting };
