/**
 * Network-aware contract configuration for Arbesk.
 *
 * Each supported network maps to its deployed contract address,
 * USDC token address, RPC URL, and metadata.
 *
 * This replaces the single .env CONTRACT_ADDRESS with per-chain
 * configuration so the UI automatically uses the correct contract
 * when the user switches networks in their wallet.
 */

import { CHAIN_IDS } from "../constants/chains.js";

export const NETWORK_CONFIGS = {
  [CHAIN_IDS.HARDHAT_LOCAL]: {
    name: "Hardhat Local",
    chainId: CHAIN_IDS.HARDHAT_LOCAL,
    contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    paidContractAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    usdcToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorer: null,
  },
  [CHAIN_IDS.MEGAETH_TESTNET]: {
    name: "MegaETH Testnet",
    chainId: CHAIN_IDS.MEGAETH_TESTNET,
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    paidContractAddress: null, // Paid tier not deployed on testnet
    usdcToken: null, // USDC not deployed on testnet
    rpcUrl: "https://carrot.megaeth.com/rpc",
    blockExplorer: "https://megaexplorer.xyz",
  },
};

/**
 * Get the full network config for a chainId.
 * @param {number|string} chainId
 * @returns {Object|null}
 */
export function getNetworkConfig(chainId) {
  return NETWORK_CONFIGS[Number(chainId)] || null;
}

/**
 * Get the ArbeskAsset contract address for a chainId.
 * @param {number|string} chainId
 * @returns {string|null}
 */
export function getContractAddress(chainId) {
  return getNetworkConfig(chainId)?.contractAddress || null;
}

/**
 * Get the USDC token address for a chainId.
 * @param {number|string} chainId
 * @returns {string|null}
 */
export function getUsdcToken(chainId) {
  return getNetworkConfig(chainId)?.usdcToken || null;
}

/**
 * Get the block explorer base URL for a chainId.
 * @param {number|string} chainId
 * @returns {string|null}
 */
export function getBlockExplorer(chainId) {
  return getNetworkConfig(chainId)?.blockExplorer || null;
}

/**
 * Get the RPC URL for a chainId.
 * @param {number|string} chainId
 * @returns {string}
 */
export function getRpcUrl(chainId) {
  return getNetworkConfig(chainId)?.rpcUrl || "http://127.0.0.1:8545";
}

/**
 * List all supported chain IDs.
 * @returns {number[]}
 */
export function getSupportedChainIds() {
  return Object.keys(NETWORK_CONFIGS).map(Number);
}
