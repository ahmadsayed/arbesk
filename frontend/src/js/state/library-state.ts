import { createStore } from "@arbesk/asset-core/state/create-store.js";
import { EVENTS } from "@arbesk/asset-core/events/bus.js";

/**
 * A collection card in the library grid. Built by
 * ui/library-controller.js (buildCollectionEntries / optimistic path) and
 * ui/library-create.js (pending mint cards).
 */
export interface LibraryCollectionItem {
  /** card id, `collection-<tokenId>` */
  id: string;
  type: "collection";
  /** ERC-721 token id (decimal string) */
  tokenId: string;
  manifestCid: string;
  name: string;
  /** null/empty when absent */
  thumbnailCid: string | null;
  status: "besked" | "minting";
  role: "owner" | "editor" | string;
  /** set on optimistic (pending) cards only */
  createdAt?: number;
}

/**
 * An asset card inside an open collection. Built by
 * ui/library-controller.js (loadCurrentAssets).
 */
export interface LibraryAssetItem {
  /** card id, `asset-<tokenId>-<assetId>` */
  id: string;
  type: "asset";
  tokenId: string;
  assetId: string;
  manifestCid: string;
  name: string;
  /** null/empty when absent */
  thumbnailCid: string | null;
  status: "besked" | string;
  role: "owner" | "editor" | string;
}

/** Any card shown in the library grid. */
export type LibraryItem = LibraryCollectionItem | LibraryAssetItem;

export interface LibraryState {
  collections: LibraryCollectionItem[];
  assets: LibraryAssetItem[];
  currentCollectionTokenId: string | number | null;
  selectedIds: Array<string | number>;
  viewMode: "grid" | string;
  sortBy: string;
  searchQuery: string;
  isLoading: boolean;
}

const _defaults: LibraryState = {
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
