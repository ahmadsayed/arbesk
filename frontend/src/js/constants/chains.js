/**
 * Chain ID constants.
 *
 * Centralizes EVM chain identifiers so the browser code does not rely on
 * scattered magic numbers. Use these everywhere a chain ID is needed.
 */

export const CHAIN_IDS = {
  HARDHAT_LOCAL: 31415822,
  MEGAETH_TESTNET: 6342,
};

/**
 * Set of chain IDs supported by the frontend wallet layer.
 *
 * The UI exposes Hardhat Local and MegaETH Testnet.
 */
export const SUPPORTED_CHAIN_IDS = [
  CHAIN_IDS.HARDHAT_LOCAL,
  CHAIN_IDS.MEGAETH_TESTNET,
];
