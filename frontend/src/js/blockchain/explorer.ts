/**
 * Builds block explorer URLs for EVM networks.
 */

import { CHAIN_IDS } from "../../../../constants/chains.js";

const EXPLORER_URLS: Record<number, string | null> = {
  // Hardhat local - no explorer
  [CHAIN_IDS.HARDHAT_LOCAL]: null,
  // Base Sepolia Testnet
  [CHAIN_IDS.BASE_TESTNET]: "https://sepolia.basescan.org",
};

/**
 * Get the explorer base URL for a chain ID.
 */
function getExplorerBaseUrl(chainId: number | string): string | null {
  return EXPLORER_URLS[Number(chainId)] || null;
}

/**
 * Build an address explorer URL.
 */
export function getAddressExplorerUrl(
  chainId: number | string,
  address: string
): string | null {
  const base = getExplorerBaseUrl(chainId);
  if (!base || !address) return null;
  return `${base}/address/${address}`;
}

/**
 * Copies text to the clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
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
