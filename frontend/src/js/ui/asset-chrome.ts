/**
 * Sole writer of the header title/meta (incl. the unsaved marker), the
 * save/publish/download buttons' visibility, and the Properties → Asset
 * section's visibility.
 * @remarks Renders purely from store state; feature modules never touch these
 *   elements, so render order cannot clobber a name (the SCENE_EMPTY header
 *   bug).
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { subscribeAsset, getAssetState } from "@arbesk/asset-core/domain/asset.js";
import {
  activeIndex,
  getState as getVersionState,
  subscribe as subscribeVersions,
} from "@arbesk/asset-core/domain/version-history-store.js";
import { walletState } from "../state/wallet-state.ts";
import { isLibraryVisitor } from "../state/library-state.ts";
import { canEdit, hasOpenAsset } from "../state/edit-mode.ts";
import { hasUnsavedChanges, onBeforeUnload } from "../state/unsaved-changes.ts";

const titleEl = document.getElementById("assetStatusName");
const metaEl = document.getElementById("assetStatusMeta");
const newBtn = document.getElementById("newMenuBtn");
const saveBtn = document.getElementById("saveAssetBtn");
const publishBtn = document.getElementById("publishAssetBtn");
const downloadBtn = document.getElementById("downloadAssetBtn");
const assetSection = document.getElementById("assetSection");

const SAVE_LABEL = "Save Draft";

/** Header meta: `v<N> · Draft|Published`, plus `· Unsaved changes` when dirty. */
function _metaText(tokenId: string | null, dirty: boolean): string {
  const status = tokenId ? "Published" : "Draft";
  const { entries } = getVersionState();
  const base = entries.length ? `v${activeIndex() + 1} · ${status}` : status;
  return dirty ? `${base} · Unsaved changes` : base;
}

function _renderSaveButton(visible: boolean, dirty: boolean): void {
  if (!saveBtn) return;
  saveBtn.hidden = !visible;
  saveBtn.classList.toggle("has-unsaved", dirty);
  saveBtn.setAttribute("aria-label", dirty ? `${SAVE_LABEL} (unsaved changes)` : SAVE_LABEL);
}

/**
 * Renders the chrome from current state.
 * @remarks Idempotent.
 */
function renderChrome(): void {
  const s = getAssetState();
  const hasAsset = hasOpenAsset();
  const hasWallet = !!walletState.get().walletAddress;
  // Marker only when the edits can actually be saved (spec §14.5).
  const dirty = canEdit() && hasUnsavedChanges();

  if (titleEl) {
    if (s.activeAssetName) titleEl.textContent = s.activeAssetName;
    else if (hasAsset) titleEl.textContent = "Untitled Asset";
    else titleEl.textContent = "No asset open";
  }
  if (metaEl) {
    metaEl.textContent =
      !s.activeAssetName && !hasAsset
        ? "Create or open an asset"
        : _metaText(s.activeAssetTokenId, dirty);
  }

  // New starts an editable draft — meaningless for anonymous/visitor views.
  if (newBtn) newBtn.hidden = !hasWallet || isLibraryVisitor();
  _renderSaveButton(hasAsset && hasWallet, dirty);
  if (publishBtn) publishBtn.hidden = !(hasAsset && hasWallet);
  // Downloads are read-only — no wallet/session required.
  if (downloadBtn) downloadBtn.hidden = !hasAsset;
  // Properties → Asset (name, collection, tier, team): only meaningful once
  // there is something to name/save.
  if (assetSection) assetSection.hidden = !hasAsset;
}

subscribeAsset(renderChrome);
subscribeVersions(renderChrome);
on(EVENTS.WALLET_CONNECTED, renderChrome);
on(EVENTS.WALLET_DISCONNECTED, renderChrome);
on(EVENTS.WALLET_STATE_CHANGED, renderChrome);
on(EVENTS.SCENE_EMPTY, renderChrome);
// Visitor mode flips with the profile subject, not the wallet.
on(EVENTS.LIBRARY_STATE_CHANGED, renderChrome);
on(EVENTS.PENDING_EDITS_CHANGED, renderChrome);
// Native "Leave site?" prompt while savable edits are unsaved.
window.addEventListener("beforeunload", (e) => {
  if (canEdit()) onBeforeUnload(e);
});
