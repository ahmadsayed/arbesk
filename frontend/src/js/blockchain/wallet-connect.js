/**
 * WalletConnect v2 Ethereum Provider
 *
 * Initializes the WalletConnect Ethereum provider for mobile wallet
 * connections via QR code or deep link.
 *
 * Uses dynamic import with CDN fallback so a broken ES-module transform
 * does not crash the entire wallet stack.
 *
 * Usage:
 *   import { getWalletConnectProvider, initWalletConnect } from './wallet-connect.js';
 *   const provider = await getWalletConnectProvider();
 *   await provider.enable();
 */

let provider = null;
let initPromise = null;
let EthereumProvider = null;

import { SUPPORTED_CHAIN_IDS } from "../constants/chains.js";
import { getConfig } from "../services/api.js";

// Default chains supported by WalletConnect (Hardhat local + MegaETH Testnet)
const DEFAULT_CHAINS = SUPPORTED_CHAIN_IDS;

const DEFAULT_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
];
const DEFAULT_EVENTS = ["chainChanged", "accountsChanged"];

/**
 * Dynamically load the WalletConnect EthereumProvider class.
 * Tries esm.sh first (more robust bundler), then jsdelivr +esm.
 * If both fail, WalletConnect is unavailable but injected wallets still work.
 */
async function loadEthereumProvider() {
  if (EthereumProvider) return EthereumProvider;

  // Try esm.sh first (esbuild-based, handles complex packages better)
  try {
    const mod = await import(
      /* webpackIgnore: true */
      "https://esm.sh/@walletconnect/ethereum-provider@2.23.9"
    );
    EthereumProvider = mod.default || mod.EthereumProvider;
    if (EthereumProvider) {
      console.log("[WALLET-CONNECT] loaded from esm.sh");
      return EthereumProvider;
    }
  } catch (err) {
    console.warn("[WALLET-CONNECT] esm.sh load failed:", err.message);
  }

  // Fallback to jsdelivr +esm
  try {
    const mod = await import(
      /* webpackIgnore: true */
      "https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.23.9/+esm"
    );
    EthereumProvider = mod.default || mod.EthereumProvider;
    if (EthereumProvider) {
      console.log("[WALLET-CONNECT] loaded from jsdelivr");
      return EthereumProvider;
    }
  } catch (err) {
    console.warn("[WALLET-CONNECT] jsdelivr load failed:", err.message);
  }

  console.error(
    "[WALLET-CONNECT] Could not load EthereumProvider from any CDN. " +
      "WalletConnect will not be available."
  );
  return null;
}

/**
 * Initialize the WalletConnect Ethereum provider.
 * Uses a singleton pattern — subsequent calls return the same instance.
 *
 * @returns {Promise<EthereumProvider|null>}
 */
export async function initWalletConnect() {
  if (provider) return provider;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const EthProvider = await loadEthereumProvider();
    if (!EthProvider) return null;

    // Get project ID from backend config or fallback
    let projectId = window.__ARBESK_CONFIG__?.walletConnectProjectId;
    if (!projectId) {
      try {
        const config = await getConfig();
        projectId = config.walletConnectProjectId;
      } catch {
        console.warn(
          "[WALLET-CONNECT] No project ID configured. WalletConnect will not work."
        );
      }
    }

    if (!projectId) {
      console.error(
        "[WALLET-CONNECT] WalletConnect project ID is required. Register at cloud.reown.com"
      );
      return null;
    }

    try {
      provider = await EthProvider.init({
        projectId,
        chains: DEFAULT_CHAINS,
        methods: DEFAULT_METHODS,
        events: DEFAULT_EVENTS,
        showQrModal: true,
        qrModalOptions: {
          themeMode:
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "dark"
              : "light",
        },
      });

      // Increase max listeners to prevent memory-leak warnings from
      // browser extensions that attach multiple listeners
      if (provider && typeof provider.setMaxListeners === "function") {
        provider.setMaxListeners(20);
      }

      console.log("[WALLET-CONNECT] provider initialized");
      return provider;
    } catch (err) {
      console.error("[WALLET-CONNECT] init failed:", err);
      return null;
    }
  })();

  return initPromise;
}

/**
 * Get the existing WalletConnect provider (or initialize if needed).
 * @returns {Promise<EthereumProvider|null>}
 */
export async function getWalletConnectProvider() {
  if (provider) return provider;
  return initWalletConnect();
}

/**
 * Connect via WalletConnect (shows QR modal).
 * @returns {Promise<string[]>} accounts
 */
export async function connectWalletConnect() {
  const wc = await getWalletConnectProvider();
  if (!wc) throw new Error("WalletConnect provider not available");

  try {
    await wc.enable();
    const accounts = wc.accounts || [];
    console.log("[WALLET-CONNECT] connected:", accounts[0]);
    return accounts;
  } catch (err) {
    console.error("[WALLET-CONNECT] connection failed:", err);
    throw err;
  }
}

/**
 * Disconnect WalletConnect session.
 */
export async function disconnectWalletConnect() {
  if (!provider) return;
  try {
    await provider.disconnect();
    console.log("[WALLET-CONNECT] disconnected");
  } catch (err) {
    console.warn("[WALLET-CONNECT] disconnect error:", err);
  } finally {
    provider = null;
    initPromise = null;
  }
}

/**
 * Check if WalletConnect is currently connected.
 * @returns {boolean}
 */
export function isWalletConnectConnected() {
  return provider?.connected || false;
}

/**
 * Subscribe to WalletConnect events.
 * @param {string} event - 'accountsChanged' | 'chainChanged' | 'disconnect'
 * @param {Function} handler
 */
export function onWalletConnectEvent(event, handler) {
  if (!provider) return;
  provider.on(event, handler);
}

/**
 * Unsubscribe from WalletConnect events.
 * @param {string} event
 * @param {Function} handler
 */
export function offWalletConnectEvent(event, handler) {
  if (!provider) return;
  provider.removeListener(event, handler);
}
