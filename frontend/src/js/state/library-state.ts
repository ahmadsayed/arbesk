import { createStore } from "@arbesk/asset-core/state/create-store.js";
import { EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "./wallet-state.ts";

/**
 * A collection card in the library grid.
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
 * An asset card inside an open collection.
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

interface LibraryState {
  collections: LibraryCollectionItem[];
  assets: LibraryAssetItem[];
  currentCollectionTokenId: string | number | null;
  selectedIds: Array<string | number>;
  viewMode: "grid" | string;
  sortBy: string;
  searchQuery: string;
  isLoading: boolean;
  /** Wallet whose public library is shown (`/library/<base58>`), or null. */
  subjectAddress: string | null;
  /** Chain the subject's tokens live on (probed); null until resolved. */
  subjectChainId: number | null;
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
  subjectAddress: null,
  subjectChainId: null,
};

const { store: libraryState, _resetForTesting } = createStore(_defaults, EVENTS.LIBRARY_STATE_CHANGED);

/**
 * True when the library shows a public profile that is NOT the connected
 * wallet (read-only visitor mode). Computed, never stored: a subject equal to
 * the connected wallet is owner mode.
 */
export function isLibraryVisitor(): boolean {
  const subject = libraryState.get().subjectAddress;
  if (!subject) return false;
  const wallet = walletState.get().walletAddress || "";
  return subject.toLowerCase() !== wallet.toLowerCase();
}

export { libraryState, _resetForTesting };
