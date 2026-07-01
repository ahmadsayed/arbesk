// @ts-nocheck
/**
 * Studio Initializer
 *
 * This module replaces the inline <script type="module"> block in studio.html
 * so that Content-Security-Policy does not require 'unsafe-inline' for scripts.
 */

import { initAssetLibrary } from "/js/ui/asset-library.js";
initAssetLibrary();

import { initLedgerPanel } from "/js/ui/ledger-panel.js";
initLedgerPanel();

import { initSidebar } from "/js/ui/sidebar.js";
initSidebar();

import { initOutliner } from "/js/ui/outliner.js";
initOutliner();

import { initNesting } from "/js/ui/nesting.js";
initNesting();

import { initCollaborators } from "/js/ui/collaborators.js";
initCollaborators();

import { initCommentsPanel } from "/js/ui/comments-panel.js";
initCommentsPanel();

import { rewriteShortcutTitles } from "/js/utils/platform.js";
rewriteShortcutTitles();

import "/js/ui/keyboard-help.js";

import { initTheme, toggleTheme } from "/js/engine/theme.js";
initTheme();
document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

import { initWalletPopover } from "/js/ui/wallet-popover.js";

import { on, EVENTS } from "../events/bus.js";
import {
  initWallet,
  connectWallet,
  switchNetwork,
} from "/js/blockchain/wallet.js";
import { walletState } from "/js/state/wallet-state.js";
import {
  updateHeaderWalletButton,
  updateHeaderWalletButtonFromState,
  isWalletAuthenticated,
} from "/js/ui/header-wallet-button.js";
import {
  getNetworkSelectKey,
  getSupportedNetworkSelectKeys,
} from "/js/blockchain/network-config.js";

// ── Headerbar network selector ──
const networkSelect = document.getElementById("headerbarNetworkSelect");
if (networkSelect) {
  networkSelect.addEventListener("change", async (e) => {
    const key = e.target.value;
    if (!key) return;
    // Only store/select keys the wallet layer actually knows about
    if (!getSupportedNetworkSelectKeys().includes(key)) {
      console.warn(`[NETWORK] Ignoring unsupported network key: ${key}`);
      return;
    }
    // Always store the user's explicit preference so auto-connect and
    // wrong-chain fallback use the network they actually selected.
    localStorage.setItem("arbesk-preferred-network", key);
    console.log("[NETWORK] Preferred network set to:", key);
    // If wallet is connected, trigger the network switch in the wallet
    if (walletState.get().walletAddress) {
      try {
        await switchNetwork(key);
      } catch (err) {
        console.error("Network switch failed:", err);
      }
    }
  });
}

// Start EIP-6963 wallet discovery (so MetaMask etc. are detected),
// but do not auto-connect. The user must click Login / Signup.
initWallet();

document
  .getElementById("connectWalletBtn")
  ?.addEventListener("click", connectWallet);
initWalletPopover();

on(EVENTS.WALLET_CONNECTED, (e) => {
  const address = e?.address || "";
  updateHeaderWalletButtonFromState(address, isWalletAuthenticated(address));

  // Sync network selector to current chain
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (netSel) {
    const key = getNetworkSelectKey(e?.chainId);
    if (key) netSel.value = key;
  }
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  updateHeaderWalletButton(null, false, null, null);
});

on(EVENTS.USER_AUTHENTICATED, (e) => {
  updateHeaderWalletButtonFromState(e?.address, true);
});

on(EVENTS.USER_AUTH_REQUIRED, (e) => {
  updateHeaderWalletButtonFromState(e?.address, false);
});
