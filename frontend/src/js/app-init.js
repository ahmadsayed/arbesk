// @ts-nocheck
/**
 * Unified App Initializer (Studio + Library SPA)
 *
 * Replaces the old per-page engine/studio-init.js + library-init.js. Both views
 * now live in one document (app.html), so this runs ONCE: it initializes the
 * shared shell (theme, wallet, popover, network selector), the Studio panels,
 * the Library controls, and finally the router which activates the initial view
 * from the URL. Top-level script → no CSP 'unsafe-inline' needed.
 */

import { on, EVENTS } from "./events/bus.js";
import {
  initWallet,
  connectWallet,
  switchNetwork,
} from "./blockchain/wallet.js";
import { walletState } from "./state/wallet-state.js";
import { libraryState } from "./state/library-state.js";
import { initTheme, toggleTheme } from "./engine/theme.js";
import { initWalletPopover } from "./ui/wallet-popover.js";
import { hideWalletModal } from "./ui/wallet-modal.js";
import {
  updateHeaderWalletButton,
  updateHeaderWalletButtonFromState,
  isWalletAuthenticated,
} from "./ui/header-wallet-button.js";
import {
  getNetworkSelectKey,
  getSupportedNetworkSelectKeys,
} from "./blockchain/network-config.js";

// ── Studio panels ──
import { initAssetLibrary } from "./ui/asset-library.js";
import { initLedgerPanel } from "./ui/ledger-panel.js";
import { initSidebar } from "./ui/sidebar.js";
import { initOutliner } from "./ui/outliner.js";
import { initNesting } from "./ui/nesting.js";
import { initCollaborators } from "./ui/collaborators.js";
import { initCommentsPanel } from "./ui/comments-panel.js";
import { rewriteShortcutTitles } from "./utils/platform.js";
import "./ui/keyboard-help.js";

// ── Library ──
import { initLibraryGrid } from "./ui/library-grid.js";
import { initLibraryToolbar } from "./ui/library-toolbar.js";
import { initLibraryContextMenu } from "./ui/library-context-menu.js";
import {
  applyWalletGate,
  loadCurrentAssets,
  refreshLibraryData,
} from "./ui/library-controller.js";

// ── Router ──
import { initRouter } from "./app/router.js";

// ─── Studio panel init ───
initAssetLibrary();
initLedgerPanel();
initSidebar();
initOutliner();
initNesting();
initCollaborators();
initCommentsPanel();
rewriteShortcutTitles();

// ─── Theme ───
initTheme();
document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

// ─── Wallet ───
// Start EIP-6963 discovery and silently restore the previous connection (owned
// by initWallet). Login / Signup buttons across both views trigger a connect.
initWallet();
for (const id of ["connectWalletBtn", "libraryConnectBtn", "galleryConnectBtn"]) {
  document.getElementById(id)?.addEventListener("click", connectWallet);
}
initWalletPopover();

// Deep link from the landing page "Log in" (/studio?login=1): open the
// connect modal immediately. If a previous session gets silently restored
// while the modal is open, close it — the user is already in.
if (new URLSearchParams(location.search).has("login")) {
  on(EVENTS.WALLET_CONNECTED, () => hideWalletModal());
  connectWallet();
}

// ─── Headerbar network selector (shared by both views) ───
document
  .getElementById("headerbarNetworkSelect")
  ?.addEventListener("change", async (e) => {
    const key = e.target.value;
    if (!key) return;
    // Only store/select keys the wallet layer actually knows about.
    if (!getSupportedNetworkSelectKeys().includes(key)) {
      console.warn(`[NETWORK] Ignoring unsupported network key: ${key}`);
      return;
    }
    // Always store the user's explicit preference so auto-connect and
    // wrong-chain fallback use the network they actually selected.
    localStorage.setItem("arbesk-preferred-network", key);
    console.log("[NETWORK] Preferred network set to:", key);
    if (walletState.get().walletAddress) {
      try {
        await switchNetwork(key);
      } catch (err) {
        console.error("Network switch failed:", err);
      }
    }
  });

// ─── Library controls ───
initLibraryGrid();
initLibraryToolbar();
initLibraryContextMenu();
applyWalletGate(Boolean(walletState.get().walletAddress));

let _lastLoadedCollectionTokenId = null;
on(EVENTS.LIBRARY_STATE_CHANGED, (state) => {
  const tokenId = state?.currentCollectionTokenId ?? null;
  if (tokenId !== _lastLoadedCollectionTokenId) {
    _lastLoadedCollectionTokenId = tokenId;
    loadCurrentAssets();
  }
});

// ─── Shared wallet / auth events (merged from both init scripts) ───
on(EVENTS.WALLET_CONNECTED, async (e) => {
  const address = e?.address || "";
  updateHeaderWalletButtonFromState(address, isWalletAuthenticated(address));

  // Sync network selector to current chain
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (netSel) {
    const key = getNetworkSelectKey(e?.chainId);
    if (key) netSel.value = key;
  }

  applyWalletGate(true);
  await refreshLibraryData();
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  updateHeaderWalletButton(null, false, null, null);
  applyWalletGate(false);
  libraryState.set({
    collections: [],
    assets: [],
    currentCollectionTokenId: null,
    selectedIds: [],
  });
});

on(EVENTS.USER_AUTHENTICATED, (e) => {
  updateHeaderWalletButtonFromState(e?.address, true);
});
on(EVENTS.USER_AUTH_REQUIRED, (e) => {
  updateHeaderWalletButtonFromState(e?.address, false);
});

// ─── Router: activate the initial view from the URL ───
initRouter();
