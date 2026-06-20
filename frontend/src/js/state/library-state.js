import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

const _defaults = {
  folders: [],
  files: [],
  currentFolderId: null,
  selectedIds: [],
  viewMode: "grid",
  sortBy: "name",
  searchQuery: "",
};

const { store: libraryState, _resetForTesting } = createStore(_defaults, EVENTS.LIBRARY_STATE_CHANGED);
export { libraryState, _resetForTesting };
