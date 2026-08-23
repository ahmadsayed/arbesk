/**
 * Unified App Initializer (Studio + Library SPA)
 *
 * Replaces the old per-page engine/studio-init.js + library-init.js. Both views
 * now live in one document (app.html), so this runs ONCE: it initializes the
 * shared shell (theme, wallet, popover, network selector), the Studio panels,
 * the Library controls, and finally the router which activates the initial view
 * from the URL. Top-level script → no CSP 'unsafe-inline' needed.
 */

import { on, EVENTS } from "./asset-core/events/bus.ts";
import { initAssetCoreBrowser } from "./asset-core-init.ts";
import {
  initWallet,
  connectWallet,
  switchNetwork,
} from "./blockchain/wallet.ts";
import { walletState } from "./state/wallet-state.ts";
import { libraryState } from "./state/library-state.ts";
import { initTheme, toggleTheme } from "./engine/theme.ts";
import { initWalletPopover } from "./ui/wallet-popover.ts";
import { hideWalletModal } from "./ui/wallet-modal.ts";
// Installs the engine/wallet-backed deps of the asset-core version-history
// store (side effect) before any scene/history events can fire.
import "./engine/version-history-deps.ts";
import {
  updateHeaderWalletButton,
  updateHeaderWalletButtonFromState,
  isWalletAuthenticated,
} from "./ui/header-wallet-button.ts";
import {
  getNetworkSelectKey,
  getSupportedNetworkSelectKeys,
} from "./blockchain/network-config.ts";

// ── Studio panels ──
import { initAssetLibrary } from "./ui/asset-library.ts";
import { initLedgerPanel } from "./ui/ledger-panel.ts";
import { initSidebar } from "./ui/sidebar.ts";
import { initOutliner } from "./ui/outliner.ts";
import { initNesting } from "./ui/nesting.ts";
import { initCollaborators } from "./ui/collaborators.ts";
import { initCommentsPanel } from "./ui/comments-panel.ts";
import { rewriteShortcutTitles } from "./utils/platform.ts";
import "./ui/keyboard-help.ts";
import "./engine/undo-controller.ts";

// ── Library ──
import { initLibraryGrid } from "./ui/library-grid.ts";
import { initLibraryToolbar } from "./ui/library-toolbar.ts";
import { initLibraryContextMenu } from "./ui/library-context-menu.ts";
import { initLibraryDetails } from "./ui/library-details.ts";
import {
  applyWalletGate,
  loadCurrentAssets,
  refreshLibraryData,
} from "./ui/library-controller.ts";

// ── Router ──
import { initRouter } from "./app/router.ts";

// ─── Asset-core composition root ───
// Install the process-wide runtime before any domain/gltf module is used.
initAssetCoreBrowser();

// ─── Studio panel init ───
// Kick off the CDP SDK load + initialize immediately when a previous CDP
// session exists, so the ~800ms token-refresh round trip overlaps with panel
// setup instead of sitting on the critical path of the silent session restore
// (autoConnectWallet awaits the same memoized promise). Gated on the
// last-wallet key so pure EOA/WalletConnect users never pay for it.
if (localStorage.getItem("arbesk-last-wallet") === "cdp") {
  import("./blockchain/wallet-cdp.ts").then((m) => m.warmupCdpClient());
}

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
    const key = (e.target as HTMLSelectElement | null)?.value;
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
initLibraryDetails();
applyWalletGate(Boolean(walletState.get().walletAddress));

let _lastLoadedCollectionTokenId: string | number | null = null;
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
  const netSel = document.getElementById(
    "headerbarNetworkSelect"
  ) as HTMLSelectElement | null;
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
