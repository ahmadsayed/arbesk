/**
 * Arbesk Block Explorer Utilities
 *
 * Builds block explorer URLs for EVM networks.
 * Supports address, transaction, and token pages.
 */

import { switchNetwork } from "./wallet.js";

const EXPLORER_URLS = {
  // Hardhat local — no explorer
  31415822: null,
  // Ethereum mainnet
  1: "https://etherscan.io",
  // Sepolia testnet
  11155111: "https://sepolia.etherscan.io",
  // Polygon
  137: "https://polygonscan.com",
  // Base
  8453: "https://basescan.org",
  // Filecoin Calibration
  314159: "https://calibration.filfox.info",
  // Filecoin Mainnet
  314: "https://filfox.info",
};

const NETWORK_NAMES = {
  31415822: "Hardhat Local",
  1: "Ethereum Mainnet",
  11155111: "Sepolia",
  137: "Polygon",
  8453: "Base",
  314159: "Filecoin Calibration",
  314: "Filecoin Mainnet",
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
