/**
 * Sole writer of the header title/meta and the save/publish/download buttons'
 * visibility.
 * @remarks Renders purely from store state; feature modules never touch these
 *   elements, so render order cannot clobber a name (the SCENE_EMPTY header
 *   bug).
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { subscribeAsset, getAssetState } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";
import { getPendingChildRefs, getPendingSourceOverrides } from "../engine/cleanup.ts";

const titleEl = document.getElementById("assetStatusName");
const metaEl = document.getElementById("assetStatusMeta");
const saveBtn = document.getElementById("saveAssetBtn");
const publishBtn = document.getElementById("publishAssetBtn");
const downloadBtn = document.getElementById("downloadAssetBtn");

/**
 * Renders the chrome from current state.
 * @remarks Idempotent.
 */
function renderChrome(): void {
  const s = getAssetState();
  const hasAsset = !!(
    s.activeAssetManifestCid ||
    getPendingChildRefs().length > 0 ||
    getPendingSourceOverrides().size > 0
  );
  const hasWallet = !!walletState.get().walletAddress;

  if (titleEl) {
    if (s.activeAssetName) titleEl.textContent = s.activeAssetName;
    else if (hasAsset) titleEl.textContent = "Untitled Asset";
    else titleEl.textContent = "No asset open";
  }
  if (metaEl) {
    if (!s.activeAssetName && !hasAsset)
      metaEl.textContent = "Create or open an asset";
    else metaEl.textContent = s.activeAssetTokenId ? "Published" : "Draft Scene";
  }

  if (saveBtn) saveBtn.hidden = !(hasAsset && hasWallet);
  if (publishBtn) publishBtn.hidden = !(hasAsset && hasWallet);
  // Downloads are read-only — no wallet/session required.
  if (downloadBtn) downloadBtn.hidden = !hasAsset;
}

subscribeAsset(renderChrome);
on(EVENTS.WALLET_CONNECTED, renderChrome);
on(EVENTS.WALLET_DISCONNECTED, renderChrome);
on(EVENTS.WALLET_STATE_CHANGED, renderChrome);
on(EVENTS.SCENE_EMPTY, renderChrome);
