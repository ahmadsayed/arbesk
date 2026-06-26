/**
 * Chain ID constants (shared between frontend and backend)
 *
 * Centralizes EVM chain identifiers so the codebase does not rely on
 * scattered magic numbers. Update this file when adding a new chain.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  MEGAETH_TESTNET: 6343,
};

/**
 * Set of chain IDs supported by the platform.
 *
 * Both frontend and backend use this list for:
 * - Wallet connection validation
 * - SIWE/session validation
 * - RPC endpoint configuration
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS);
