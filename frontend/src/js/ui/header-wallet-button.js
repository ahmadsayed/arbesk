// @ts-nocheck
/**
 * Shared header wallet button state updater.
 *
 * Keeps studio-init.js and library-init.js consistent for:
 *   - disconnected: show #connectWalletBtn, hide #disconnectWalletBtn
 *   - connected via CDP email: simple "Account" label, hide network selector
 *   - connected via crypto wallet: truncated address + optional Sign In dot
 */

import { truncateAddress } from "../utils/format.js";
import { getCachedSession } from "../services/api.js";

/**
 * Update the header wallet button and network selector for the current wallet state.
 *
 * @param {string|null} address
 * @param {boolean} isAuthenticated
 * @param {'cdp'|'walletconnect'|'injected'|null} walletSource
 * @param {string|null} email
 */
export function updateHeaderWalletButton(address, isAuthenticated, walletSource, email = null) {
  const connectBtn = document.getElementById("connectWalletBtn");
  const disconnectBtn = document.getElementById("disconnectWalletBtn");
  const networkSelect = document.getElementById("headerbarNetworkSelect");

  if (!connectBtn || !disconnectBtn) return;

  if (!address) {
    connectBtn.classList.remove("hidden");
    connectBtn.classList.add("disconnected");
    disconnectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("auth-required");
    if (networkSelect) {
      networkSelect.classList.remove("connected");
      networkSelect.classList.remove("hidden");
    }

    const text = disconnectBtn.querySelector("span");
    if (text) text.textContent = "Disconnect";
    return;
  }

  connectBtn.classList.add("hidden");
  connectBtn.classList.remove("disconnected");
  disconnectBtn.classList.remove("hidden");

  const text = disconnectBtn.querySelector("span");
  if (!text) return;

  if (walletSource === "cdp") {
    // Web2-friendly: show email (truncated), no Sign In dot, hide network selector
    const displayEmail = email && email.length > 24 ? `${email.slice(0, 21)}…` : (email || "Account");
    text.textContent = displayEmail;
    disconnectBtn.classList.remove("auth-required");
    if (networkSelect) networkSelect.classList.add("hidden");
  } else {
    // Crypto wallet: truncated address + Sign In reminder if needed
    const truncated = truncateAddress(address);
    text.textContent = isAuthenticated ? truncated : `${truncated} • Sign In`;
    disconnectBtn.classList.toggle("auth-required", !isAuthenticated);
    if (networkSelect) {
      networkSelect.classList.add("connected");
      networkSelect.classList.remove("hidden");
    }
  }
}

/**
 * Convenience: derive auth state from cached session and current address.
 * @param {string|null} address
 * @returns {boolean}
 */
export function isWalletAuthenticated(address) {
  const cached = getCachedSession();
  return !!(cached && address && cached.address === address.toLowerCase());
}
