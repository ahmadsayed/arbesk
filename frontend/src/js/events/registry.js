/**
 * Arbesk Studio Event Registry
 *
 * Single source of truth for all CustomEvent names. Import EVENTS constants
 * instead of raw strings, and use emit()/on() instead of raw dispatchEvent/addEventListener.
 */

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

// ─── Payload Typedefs ─────────────────────────────────────────────────────────

/**
 * @typedef {{ manifest: object, manifestCid: string }} SceneReadyDetail
 * @typedef {{ nodeId: string, mesh: object }} NodeSelectedDetail
 * @typedef {{ nodeId: string, meshName: string }} SubmeshSelectedDetail
 * @typedef {{ theme: string }} ThemeChangedDetail
 * @typedef {{ walletAddress: string, chainId: number }} WalletConnectedDetail
 * @typedef {{ tokenId: string, txHash: string }} AssetBurnedDetail
 * @typedef {{ cid: string }} AssetDraftSavedDetail
 * @typedef {{ manifestCid: string, tokenId: string }} AssetPublishedDetail
 * @typedef {{ childRef: object, nodeId: string }} NestingDiveRequestedDetail
 * @typedef {{ depth: number, name: string }} NestingDidDiveDetail
 * @typedef {{ depth: number, name: string }} NestingDidAscendDetail
 * @typedef {{ nodeId: string }} OutlinerNodeSelectedDetail
 * @typedef {{ nodeId: string }} OutlinerRemoveRequestedDetail
 * @typedef {{ nodeId: string, childRef: object, tokenId: string, contractAddress: string, chainId: number }} AssetLinkedDroppedDetail
 * @typedef {{ tokenId: string }} AssetOpenByTokenIdDetail
 * @typedef {{ txHash: string, nodeId: string, prompt: string }} WalletGenerationPaidDetail
 * @typedef {{ nodeId: string, tokenId: string }} SceneTokenChildAddedDetail
 * @typedef {{ nodeId: string, url: string }} AssetAddLinkedRequestedDetail
 */

// ─── Listener Count Tracking (dev-mode orphan detection) ─────────────────────

/** @type {Map<string, number>} */
const _listenerCounts = new Map();

const _isDev =
  typeof location !== "undefined" && location.hostname === "localhost";

// Events emitted intentionally before any consumer exists (future-only hooks).
const _futureOnlyEvents = new Set([
  EVENTS.NESTING_DID_DIVE,
  EVENTS.NESTING_DID_ASCEND,
  EVENTS.ASSET_STATE_CHANGED,
  EVENTS.WALLET_STATE_CHANGED,
  EVENTS.UI_STATE_CHANGED,
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Dispatch a named CustomEvent on document.
 * In dev mode, warns to the console if no listeners are registered.
 *
 * @param {string} name - Use an EVENTS.* constant
 * @param {*} [detail]  - Optional payload
 */
export function emit(name, detail) {
  if (_isDev && !_listenerCounts.get(name) && !_futureOnlyEvents.has(name)) {
    console.warn(`[EVENTS] "${name}" dispatched with no registered listeners`);
  }
  document.dispatchEvent(
    detail !== undefined
      ? new CustomEvent(name, { detail })
      : new CustomEvent(name)
  );
}

/**
 * Register a CustomEvent listener on document.
 *
 * @param {string}        name    - Use an EVENTS.* constant
 * @param {EventListener} handler
 */
export function on(name, handler) {
  _listenerCounts.set(name, (_listenerCounts.get(name) || 0) + 1);
  document.addEventListener(name, handler);
}

/**
 * Remove a CustomEvent listener from document and decrement the dev-mode count.
 *
 * @param {string}        name    - Use an EVENTS.* constant
 * @param {EventListener} handler
 */
export function off(name, handler) {
  const count = _listenerCounts.get(name) || 0;
  if (count > 0) {
    _listenerCounts.set(name, count - 1);
  }
  document.removeEventListener(name, handler);
}

/**
 * Reset listener counts. Only call this in tests.
 * @internal
 */
export function _resetListenerCounts() {
  _listenerCounts.clear();
}
