// @ts-nocheck
/**
 * Smart-wallet chain support constants.
 *
 * Kept in a standalone module (no thirdweb dependency) so other modules can
 * check smart-wallet support without pulling in the CDN-only thirdweb bundle.
 */

import { CHAIN_IDS } from "../../../../constants/chains.js";

/** Chain IDs where Thirdweb's bundler supports ERC-4337 smart wallets.
 *  Base Sepolia is intentionally excluded — it is EOA-only.
 */
export const SMART_WALLET_SUPPORTED_CHAIN_IDS = [CHAIN_IDS.MONAD_TESTNET];

/**
 * Check whether the given chain supports Thirdweb smart wallets.
 * @param {number|string} chainId
 * @returns {boolean}
 */
export function isSmartWalletSupported(chainId) {
  return SMART_WALLET_SUPPORTED_CHAIN_IDS.includes(Number(chainId));
}
