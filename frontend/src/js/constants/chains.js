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
  SEI_TESTNET: 1328,
};

/**
 * Set of chain IDs supported by the frontend wallet layer.
 *
 * The UI only exposes Hardhat Local and SEI Testnet, so those are the
 * only chains the wallet layer treats as supported. Optimism logic is
 * preserved in the code for compatibility/reuse but is not selectable
 * in the studio UI.
 */
export const SUPPORTED_CHAIN_IDS = [
  CHAIN_IDS.HARDHAT_LOCAL,
  CHAIN_IDS.SEI_TESTNET,
];
