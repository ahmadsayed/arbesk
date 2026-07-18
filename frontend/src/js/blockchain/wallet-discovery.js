// @ts-nocheck
/**
 * EIP-6963 Multi-Injected Wallet Discovery
 *
 * Detects all browser-installed wallets via the standardized
 * eip6963:announceProvider event. Maintains a registry of available
 * wallets that the user can choose from.
 *
 * Usage:
 *   import { getWallets, requestWallets, onWalletsUpdated, connectWalletByRdns } from './wallet-discovery.js';
 *   requestWallets();
 *   onWalletsUpdated((wallets) => { console.log('Available:', wallets); });
 */

/** @type {Map<string, EIP6963Wallet>} */
const wallets = new Map();

const listeners = new Set();

/**
 * @typedef {Object} EIP6963Wallet
 * @property {string} rdns - Reverse domain name (e.g., "io.metamask")
 * @property {string} name - Human-readable name (e.g., "MetaMask")
 * @property {string} icon - Base64 SVG icon
 * @property {Object} provider - EIP-1193 provider instance
 */

/**
 * Notify all registered listeners with the current wallet list.
 */
function notify() {
  const list = Array.from(wallets.values());
  listeners.forEach((fn) => {
    try {
      fn(list);
    } catch (e) {
      console.error("[WALLET-DISCOVERY] listener error:", e);
    }
  });
}

/**
 * Handle an EIP-6963 announceProvider event.
 * @param {CustomEvent} event
 */
function onAnnounceProvider(event) {
  if (!event.detail?.info || !event.detail?.provider) return;

  const { info, provider } = event.detail;
  const rdns = info.rdns;

  if (!rdns) {
    console.warn("[WALLET-DISCOVERY] wallet announced without rdns:", info.name);
    return;
  }

  // Update or add wallet
  wallets.set(rdns, {
    rdns,
    name: info.name || rdns,
    icon: info.icon || "",
    provider,
  });

  console.log(`[WALLET-DISCOVERY] discovered: ${info.name} (${rdns})`);
  notify();
}

/**
 * Start listening for wallet announcements.
 * Call once at app startup.
 */
export function startDiscovery() {
  if (typeof window === "undefined") return;

  window.addEventListener("eip6963:announceProvider", onAnnounceProvider);

  // Request already-initialized wallets to announce themselves
  requestWallets();
}

/**
 * Request all wallets to announce themselves.
 * Call before showing the wallet picker.
 */
export function requestWallets() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Register a callback for wallet list updates.
 * @param {Function} callback - receives array of EIP6963Wallet
 * @returns {Function} unsubscribe function
 */
export function onWalletsUpdated(callback) {
  listeners.add(callback);
  // Immediately call with current state
  callback(Array.from(wallets.values()));
  return () => listeners.delete(callback);
}

/**
 * Get the current list of discovered wallets.
 * @returns {EIP6963Wallet[]}
 */
export function getWallets() {
  return Array.from(wallets.values());
}

/**
 * Get a single wallet by its rdns.
 * @param {string} rdns
 * @returns {EIP6963Wallet|null}
 */
export function getWalletByRdns(rdns) {
  return wallets.get(rdns) || null;
}
