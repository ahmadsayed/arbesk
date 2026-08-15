import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

/**
 * @typedef {Object} LibraryState
 * @property {any[]} collections
 * @property {any[]} assets
 * @property {string|number|null} currentCollectionTokenId
 * @property {Array<string|number>} selectedIds
 * @property {"grid"|string} viewMode
 * @property {string} sortBy
 * @property {string} searchQuery
 * @property {boolean} isLoading
 */

/** @type {LibraryState} */
const _defaults = {
  collections: [],
  assets: [],
  currentCollectionTokenId: null,
  selectedIds: [],
  viewMode: "grid",
  sortBy: "name",
  searchQuery: "",
  isLoading: false,
};

const { store: libraryState, _resetForTesting } = createStore(_defaults, EVENTS.LIBRARY_STATE_CHANGED);
export { libraryState, _resetForTesting };
