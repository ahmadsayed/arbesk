import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

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
