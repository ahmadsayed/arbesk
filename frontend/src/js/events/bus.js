// @ts-nocheck
/**
 * Arbesk Studio Event Bus
 *
 * Singleton mitt instance. Import EVENTS constants and on/off/emit from here
 * instead of using document.dispatchEvent - handlers receive the payload
 * directly, not wrapped in a CustomEvent.
 *
 * Usage:
 *   import { on, off, emit, EVENTS } from "../events/bus.js";
 *   on(EVENTS.SCENE_READY, ({ manifest, manifestCid }) => { ... });
 *   emit(EVENTS.SCENE_READY, { manifest, manifestCid });
 */

import mitt from "./mitt.mjs";

// ─── Event Name Constants ─────────────────────────────────────────────────────

export const EVENTS = {
  ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
  ASSET_BURNED:               "asset:burned",
  ASSET_CLEARED:              "asset:cleared",
  ASSET_DRAFT_SAVED:          "asset:draftSaved",
  ASSET_LINKED_DROPPED:       "asset:linkedDropped",
  ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
  ASSET_PUBLISHED:            "asset:published",
  ASSET_STATE_CHANGED:        "asset:stateChanged",
  COMMENT_THREAD_CHANGE:      "commentThread:change",
  COMMENT_THREAD_STATUS:      "commentThread:status",
  COLLECTION_OPENED:          "collection:opened",
  LIBRARY_STATE_CHANGED:      "library:stateChanged",
  NESTING_DID_ASCEND:         "nesting:didAscend",
  NESTING_DID_DIVE:           "nesting:didDive",
  NESTING_DIVE_REQUESTED:     "nesting:diveRequested",
  NODE_DESELECTED:            "node:deselected",
  NODE_SELECTED:              "node:selected",
  OUTLINER_NODE_SELECTED:     "outliner:nodeSelected",
  OUTLINER_REMOVE_REQUESTED:  "outliner:removeRequested",
  SCENE_CLEARED:              "scene:cleared",
  SCENE_EMPTY:                "scene:empty",
  SCENE_READY:                "scene:ready",
  SCENE_TOKEN_CHILD_ADDED:    "scene:tokenChildAdded",
  SUBMESH_SELECTED:           "submesh:selected",
  THEME_CHANGED:              "theme:changed",
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

export const on   = _bus.on.bind(_bus);
export const off  = _bus.off.bind(_bus);
export const emit = _bus.emit.bind(_bus);
