/**
 * Library Page Initializer
 *
 * Mirrors engine/studio-init.js: top-level script, no CSP unsafe-inline needed.
 */

import { on, EVENTS } from "./events/bus.js";
import { initWallet, autoConnectWallet, connectWallet } from "./blockchain/wallet.js";
import { initWalletPopover } from "./ui/wallet-popover.js";
import { initTheme, toggleTheme } from "./engine/theme.js";
import { walletState } from "./state/wallet-state.js";
import { truncateAddress } from "./utils/format.js";
import { getCachedSession } from "./services/api.js";
import { initLibraryGrid } from "./ui/library-grid.js";
import { initLibraryToolbar } from "./ui/library-toolbar.js";
import { initLibraryContextMenu } from "./ui/library-context-menu.js";

function applyWalletGate(connected) {
  const gate = document.getElementById("libraryGate");
  const main = document.getElementById("libraryMain");
  if (!gate || !main) return;
  gate.classList.toggle("hidden", connected);
  main.classList.toggle("hidden", !connected);
}

function updateWalletButtonState(address, isAuthenticated) {
  const d = document.getElementById("disconnectWalletBtn");
  if (!d) return;
  const text = d.querySelector("span") || d;
  if (!address) {
    if (text) text.textContent = "Disconnect";
    return;
  }
  const truncated = truncateAddress(address);
  if (text) {
    text.textContent = isAuthenticated ? truncated : `${truncated} • Sign In`;
  }
  d.classList.toggle("auth-required", !isAuthenticated);
}

initTheme();
document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

initWallet();
autoConnectWallet();
document.getElementById("connectWalletBtn")?.addEventListener("click", connectWallet);
document.getElementById("libraryConnectBtn")?.addEventListener("click", connectWallet);
initWalletPopover();

initLibraryGrid();
initLibraryToolbar();
initLibraryContextMenu();
applyWalletGate(Boolean(walletState.get().walletAddress));

on(EVENTS.WALLET_CONNECTED, (e) => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  if (c) {
    c.classList.add("hidden");
    c.classList.remove("disconnected");
  }
  if (d) d.classList.remove("hidden");

  const address = e?.address || "";
  const cached = getCachedSession();
  const isAuth = cached && cached.address === address.toLowerCase();
  updateWalletButtonState(address, isAuth);
  applyWalletGate(true);
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  const c = document.getElementById("connectWalletBtn");
  const d = document.getElementById("disconnectWalletBtn");
  if (c) {
    c.classList.remove("hidden");
    c.classList.add("disconnected");
  }
  if (d) {
    d.classList.add("hidden");
    d.classList.remove("auth-required");
  }
  updateWalletButtonState(null, false);
  applyWalletGate(false);
});

on(EVENTS.USER_AUTHENTICATED, (e) => updateWalletButtonState(e?.address, true));
on(EVENTS.USER_AUTH_REQUIRED, (e) => updateWalletButtonState(e?.address, false));
