// @ts-nocheck
/**
 * Smart-wallet chain support constants.
 *
 * Kept in a standalone module so other modules can check smart-wallet support
 * without pulling in the CDP wallet bundle.
 */

import { CHAIN_IDS } from "../../../../constants/chains.js";

/** Chain IDs where CDP ERC-4337 smart wallets are supported.
 *  Currently Base Sepolia only.
 */
export const SMART_WALLET_SUPPORTED_CHAIN_IDS = [CHAIN_IDS.BASE_TESTNET];

/**
 * Check whether the given chain supports CDP smart wallets.
 * @param {number|string} chainId
 * @returns {boolean}
 */
export function isSmartWalletSupported(chainId) {
  return SMART_WALLET_SUPPORTED_CHAIN_IDS.includes(Number(chainId));
}
