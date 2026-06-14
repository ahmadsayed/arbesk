/**
 * Chain ID constants.
 *
 * Centralizes EVM chain identifiers so the codebase does not rely on
 * scattered magic numbers. Use these everywhere a chain ID is needed.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  OPTIMISM_SEPOLIA: 11155420,
  OPTIMISM_MAINNET: 10,
  SEI_TESTNET: 1328,
};

/**
 * Set of chain IDs supported by the backend for SIWE/session validation.
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS);
