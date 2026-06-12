/**
 * Chain ID constants.
 *
 * Centralizes EVM chain identifiers so the browser code does not rely on
 * scattered magic numbers. Use these everywhere a chain ID is needed.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  OPTIMISM_SEPOLIA: 11155420,
  OPTIMISM_MAINNET: 10,
};

/**
 * Set of chain IDs supported by the frontend wallet layer.
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS);
