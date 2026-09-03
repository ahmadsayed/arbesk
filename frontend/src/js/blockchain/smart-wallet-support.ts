/**
 * Smart-wallet chain support constants.
 * @remarks Standalone module so consumers can check support without pulling
 *   in the CDP wallet bundle.
 */

import { CHAIN_IDS } from "../../../../constants/chains.js";

/** Chain IDs where CDP ERC-4337 smart wallets are supported.
 *  Currently Base Sepolia only.
 */
const SMART_WALLET_SUPPORTED_CHAIN_IDS = [CHAIN_IDS.BASE_TESTNET];

/**
 * Check whether the given chain supports CDP smart wallets.
 */
export function isSmartWalletSupported(chainId: number | string | null): boolean {
  return SMART_WALLET_SUPPORTED_CHAIN_IDS.includes(Number(chainId));
}
