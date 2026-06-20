/**
 * Chain ID constants.
 *
 * Centralizes EVM chain identifiers so the codebase does not rely on
 * scattered magic numbers. Use these everywhere a chain ID is needed.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  MEGAETH_TESTNET: 6342,
};

/**
 * Set of chain IDs supported by the backend for SIWE/session validation.
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS);
