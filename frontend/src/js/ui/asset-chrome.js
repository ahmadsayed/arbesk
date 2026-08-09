// @ts-check
/**
 * Asset chrome — the ONLY writer of the header title/meta and the
 * save/publish/download buttons' visibility. Renders purely from store
 * state (domain snapshot + wallet); feature modules never touch these
 * elements, so render order can never clobber a name (the SCENE_EMPTY
 * header bug).
 */
import { on, EVENTS } from "../events/bus.js";
import { subscribeAsset } from "../domain/asset.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { getPendingChildRefs } from "../engine/cleanup.js";

const titleEl = document.getElementById("assetStatusName");
const metaEl = document.getElementById("assetStatusMeta");
const saveBtn = document.getElementById("saveAssetBtn");
const publishBtn = document.getElementById("publishAssetBtn");
const downloadBtn = document.getElementById("downloadAssetBtn");

/**
 * Render the chrome from current state. Idempotent.
 */
function renderChrome() {
  const s = assetState.get();
  const hasAsset = !!(
    s.activeAssetManifestCid || getPendingChildRefs().length > 0
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
