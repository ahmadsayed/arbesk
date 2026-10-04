/**
 * View/Edit mode store.
 * @remarks The Studio is view-only by default; placement tools appear only in
 *   Edit mode, which is offered only when the open asset can be saved (asset
 *   open, wallet connected, not visiting someone else's library). Leaving Edit
 *   keeps staged edits — the unsaved marker (ui/asset-chrome.ts) tracks them.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, subscribeAsset } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "./wallet-state.ts";
import { isLibraryVisitor } from "./library-state.ts";
import { getPendingChildRefs, getPendingSourceOverrides } from "../engine/cleanup.ts";

let _editing = false;
const _listeners = new Set<() => void>();

/** True when there is something open to view, save, or place. */
export function hasOpenAsset(): boolean {
  return !!(
    getAssetState().activeAssetManifestCid ||
    getPendingChildRefs().length > 0 ||
    getPendingSourceOverrides().size > 0
  );
}

export function canEdit(): boolean {
  return hasOpenAsset() && !!walletState.get().walletAddress && !isLibraryVisitor();
}

export function isEditing(): boolean {
  return _editing;
}

function _notify(): void {
  for (const fn of _listeners) fn();
}

/**
 * Enters or leaves Edit mode.
 * @returns the resulting mode (entering is refused when !canEdit()).
 */
export function setEditing(next: boolean): boolean {
  const value = next && canEdit();
  if (value !== _editing) {
    _editing = value;
    _notify();
  }
  return _editing;
}

export function toggleEditing(): boolean {
  return setEditing(!_editing);
}

/**
 * Subscribes to mode and can-edit changes.
 * @returns an unsubscribe function.
 */
export function subscribeEditMode(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

export function _resetEditModeForTesting(): void {
  _editing = false;
}

// Can-edit may have flipped: exit Edit if it is gone, and let subscribers
// re-render the Edit button's visibility either way.
function _recheck(): void {
  if (_editing && !canEdit()) _editing = false;
  _notify();
}

subscribeAsset(_recheck);
on(EVENTS.WALLET_STATE_CHANGED, _recheck);
on(EVENTS.WALLET_CONNECTED, _recheck);
on(EVENTS.WALLET_DISCONNECTED, _recheck);
on(EVENTS.LIBRARY_STATE_CHANGED, _recheck);
on(EVENTS.PENDING_EDITS_CHANGED, _recheck);
// Every asset open / version navigation / New goes through clearScene.
on(EVENTS.SCENE_CLEARED, () => setEditing(false));
