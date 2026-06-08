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

import { initTheme, toggleTheme } from "/js/engine/theme.js";
initTheme();
document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

import { initWalletPopover } from "/js/ui/wallet-popover.js";

import { initWallet, autoConnectWallet, connectWallet, switchNetwork } from "/js/blockchain/wallet.js";

// ── Headerbar network selector ──
const networkSelect = document.getElementById("headerbarNetworkSelect");
if (networkSelect) {
  networkSelect.addEventListener("change", async (e) => {
    const key = e.target.value;
    if (!key) return;
    // If wallet is connected, trigger the network switch in the wallet
    if (window.walletAddress) {
      try {
        await switchNetwork(key);
      } catch (err) {
        console.error("Network switch failed:", err);
      }
    } else {
      // Not connected yet — just store preference for when we connect
      localStorage.setItem("arbesk-preferred-network", key);
      console.log("[NETWORK] Preferred network set to:", key);
    }
  });
}

// Start EIP-6963 wallet discovery (so MetaMask etc. are detected)
initWallet();

// Try to reconnect a previously authorized wallet (silent, no popup)
autoConnectWallet();

document.getElementById("connectWalletBtn")?.addEventListener("click", connectWallet);
initWalletPopover();

document.addEventListener("wallet:connected", (e) => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.add("hidden");
    c.classList.remove("disconnected");
  }
  if (d) {
    d.classList.remove("hidden");
    const addr = e.detail?.address || "";
    const text = d.querySelector("span") || d;
    if (text) text.textContent = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Wallet";
  }
  // Green dot + sync network selector to current chain
  if (netSel) {
    netSel.classList.add("connected");
    const chainId = e.detail?.chainId;
    const keyMap = { 31415822: "hardhat", 84532: "baseSepolia", 80002: "polygonAmoy" };
    const key = keyMap[chainId];
    if (key) netSel.value = key;
  }
});

document.addEventListener("wallet:disconnected", () => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  const netSel = document.getElementById("headerbarNetworkSelect");
  if (c) {
    c.classList.remove("hidden");
    c.classList.add("disconnected");
  }
  if (d) {
    d.classList.add("hidden");
    const text = d.querySelector("span");
    if (text) text.textContent = "Disconnect";
  }
  // Gray dot when disconnected
  if (netSel) netSel.classList.remove("connected");
});
