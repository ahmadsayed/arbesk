/**
 * Arbesk Studio Event Bus.
 * @remarks Singleton mitt instance; handlers receive the payload directly, not
 *   wrapped in a CustomEvent.
 */

export type EventHandler = (payload?: any) => void;

import mitt from "./mitt.ts";

// ─── Event Name Constants ─────────────────────────────────────────────────────

export const EVENTS = {
  ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
  ASSET_BURNED:               "asset:burned",
  ASSET_CLEARED:              "asset:cleared",
  ASSET_DRAFT_SAVED:          "asset:draftSaved",
  ASSET_FILE_DROPPED:         "asset:fileDropped",
  ASSET_FILE_STAGED:          "asset:fileStaged",
  ASSET_LINKED_DROPPED:       "asset:linkedDropped",
  ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
  ASSET_PUBLISHED:            "asset:published",
  ASSET_PUBLISH_PENDING:      "asset:publishPending",
  ASSET_STATE_CHANGED:        "asset:stateChanged",
  ASSET_URI_CHANGED:          "asset:uriChanged",
  ASSET_URI_UPDATED:          "asset:uriUpdated",
  COMMENT_THREAD_CHANGE:      "commentThread:change",
  COMMENT_THREAD_STATUS:      "commentThread:status",
  COLLECTION_OPENED:          "collection:opened",
  HISTORY_VERSION_SELECTED:   "asset:historyVersionSelected",
  HISTORY_VERSION_ACTIONABLE: "asset:historyVersionActionable",
  LIBRARY_STATE_CHANGED:      "library:stateChanged",
  NESTING_DID_ASCEND:         "nesting:didAscend",
  NESTING_DID_DIVE:           "nesting:didDive",
  NESTING_DIVE_REQUESTED:     "nesting:diveRequested",
  NODE_DESELECTED:            "node:deselected",
  NODE_DOUBLE_CLICKED:        "node:doubleClicked",
  NODE_LIST_CHANGED:          "node:listChanged",
  NODE_SELECTED:              "node:selected",
  OUTLINER_NODE_SELECTED:     "outliner:nodeSelected",
  OUTLINER_REMOVE_REQUESTED:  "outliner:removeRequested",
  SCENE_CLEARED:              "scene:cleared",
  SCENE_EMPTY:                "scene:empty",
  SCENE_READY:                "scene:ready",
  SCENE_TOKEN_CHILD_ADDED:    "scene:tokenChildAdded",
  SELECTION_CHANGED:          "selection:changed",
  SIDEBAR_VIEW_CHANGED:       "sidebar:viewChanged",
  SUBMESH_SELECTED:           "submesh:selected",
  THEME_CHANGED:              "theme:changed",
  TRANSFORM_MODE_CHANGED:     "transform:modeChanged",
  TRANSFORM_STAGED:           "transform:staged",
  UI_STATE_CHANGED:           "ui:stateChanged",
  USER_AUTHENTICATED:         "user:authenticated",
  USER_AUTH_REQUIRED:         "user:auth-required",
  WALLET_CONNECTED:           "wallet:connected",
  WALLET_DISCONNECTED:        "wallet:disconnected",
  WALLET_GENERATION_PAID:     "wallet:generationPaid",
  WALLET_STATE_CHANGED:       "wallet:stateChanged",
};

// ─── Singleton bus ────────────────────────────────────────────────────────────

const _bus = mitt();

/**
 * Subscribe to an event.
 * @param type - one of the EVENTS values
 * @returns unsubscribe function
 */
export function on(type: string, handler: EventHandler): () => void {
  _bus.on(type, handler);
  return () => _bus.off(type, handler);
}
export const off: (type: string, handler?: EventHandler) => void = _bus.off.bind(_bus);
export const emit: (type: string, data?: any) => void = _bus.emit.bind(_bus);
