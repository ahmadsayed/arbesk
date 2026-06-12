/**
 * Arbesk Block Explorer Utilities
 *
 * Builds block explorer URLs for EVM networks.
 * Supports address, transaction, and token pages.
 */

import { switchNetwork } from "./wallet.js";
import { CHAIN_IDS } from "../constants/chains.js";

const EXPLORER_URLS = {
  // Hardhat local — no explorer
  [CHAIN_IDS.HARDHAT_LOCAL]: null,
  // Optimism Sepolia testnet
  [CHAIN_IDS.OPTIMISM_SEPOLIA]: "https://sepolia-optimism.etherscan.io",
  // Optimism mainnet
  [CHAIN_IDS.OPTIMISM_MAINNET]: "https://optimistic.etherscan.io",
};

const NETWORK_NAMES = {
  [CHAIN_IDS.HARDHAT_LOCAL]: "Hardhat Local",
  [CHAIN_IDS.OPTIMISM_SEPOLIA]: "Optimism Sepolia",
  [CHAIN_IDS.OPTIMISM_MAINNET]: "Optimism Mainnet",
};

/**
 * Get the human-readable network name for a chain ID.
 * @param {number|string} chainId
 * @returns {string}
 */
export function getNetworkName(chainId) {
  return NETWORK_NAMES[Number(chainId)] || `Chain ${chainId}`;
}

/**
 * Get the explorer base URL for a chain ID.
 * @param {number|string} chainId
 * @returns {string|null}
 */
export function getExplorerBaseUrl(chainId) {
  return EXPLORER_URLS[Number(chainId)] || null;
}

/**
 * Build an address explorer URL.
 * @param {number|string} chainId
 * @param {string} address
 * @returns {string|null}
 */
export function getAddressExplorerUrl(chainId, address) {
  const base = getExplorerBaseUrl(chainId);
  if (!base || !address) return null;
  return `${base}/address/${address}`;
}

/**
 * Build a transaction explorer URL.
 * @param {number|string} chainId
 * @param {string} txHash
 * @returns {string|null}
 */
export function getTxExplorerUrl(chainId, txHash) {
  const base = getExplorerBaseUrl(chainId);
  if (!base || !txHash) return null;
  return `${base}/tx/${txHash}`;
}

/**
 * Build a token explorer URL.
 * @param {number|string} chainId
 * @param {string} contractAddress
 * @param {string|number} tokenId
 * @returns {string|null}
 */
export function getTokenExplorerUrl(chainId, contractAddress, tokenId) {
  const base = getExplorerBaseUrl(chainId);
  if (!base || !contractAddress) return null;
  return `${base}/token/${contractAddress}?a=${tokenId}`;
}

/**
 * Open an explorer URL in a new tab.
 * @param {string|null} url
 * @returns {boolean} whether a tab was opened
 */
export function openExplorer(url) {
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Copy text to clipboard with a callback for feedback.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export { switchNetwork };
