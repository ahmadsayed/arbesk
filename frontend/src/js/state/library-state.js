import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

/**
 * A collection card in the library grid. Built by
 * ui/library-controller.js (buildCollectionEntries / optimistic path) and
 * ui/library-create.js (pending mint cards).
 * @typedef {Object} LibraryCollectionItem
 * @property {string} id - card id, `collection-<tokenId>`
 * @property {"collection"} type
 * @property {string} tokenId - ERC-721 token id (decimal string)
 * @property {string} manifestCid
 * @property {string} name
 * @property {string|null} thumbnailCid - null/empty when absent
 * @property {"besked"|"minting"} status
 * @property {"owner"|"editor"|string} role
 * @property {number} [createdAt] - set on optimistic (pending) cards only
 */

/**
 * An asset card inside an open collection. Built by
 * ui/library-controller.js (loadCurrentAssets).
 * @typedef {Object} LibraryAssetItem
 * @property {string} id - card id, `asset-<tokenId>-<assetId>`
 * @property {"asset"} type
 * @property {string} tokenId
 * @property {string} assetId
 * @property {string} manifestCid
 * @property {string} name
 * @property {string|null} thumbnailCid - null/empty when absent
 * @property {"besked"|string} status
 * @property {"owner"|"editor"|string} role
 */

/**
 * Any card shown in the library grid.
 * @typedef {LibraryCollectionItem|LibraryAssetItem} LibraryItem
 */

/**
 * @typedef {Object} LibraryState
 * @property {LibraryCollectionItem[]} collections
 * @property {LibraryAssetItem[]} assets
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
