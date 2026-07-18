// @ts-nocheck
/**
 * Arbesk Block Explorer Utilities
 *
 * Builds block explorer URLs for EVM networks.
 */

import { switchNetwork } from "./wallet.js";
import { CHAIN_IDS } from "../../../../constants/chains.js";

const EXPLORER_URLS = {
  // Hardhat local - no explorer
  [CHAIN_IDS.HARDHAT_LOCAL]: null,
  // Base Sepolia Testnet
  [CHAIN_IDS.BASE_TESTNET]: "https://sepolia.basescan.org",
};

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
