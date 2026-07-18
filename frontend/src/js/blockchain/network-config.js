// @ts-nocheck
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

import { CHAIN_IDS } from "../../../../constants/chains.js";

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
  [CHAIN_IDS.BASE_TESTNET]: {
    name: "Base Sepolia Testnet",
    chainId: CHAIN_IDS.BASE_TESTNET,
    contractAddress: "0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8",
    paidContractAddress: null, // Paid tier not deployed on testnet
    usdcToken: null, // USDC not deployed on testnet
    rpcUrl: "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
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
 * Get the RPC URL for a chainId.
 * @param {number|string} chainId
 * @returns {string}
 */
export function getRpcUrl(chainId) {
  return getNetworkConfig(chainId)?.rpcUrl || "http://127.0.0.1:8545";
}

/** Maps chainId to the headerbar network-select option value. */
const NETWORK_SELECT_KEYS = {
  [CHAIN_IDS.HARDHAT_LOCAL]: "hardhat",
  [CHAIN_IDS.BASE_TESTNET]: "baseSepolia",
};

/**
 * Get the headerbar network-select option key for a chainId.
 * @param {number|string} chainId
 * @returns {string|null}
 */
export function getNetworkSelectKey(chainId) {
  return NETWORK_SELECT_KEYS[Number(chainId)] || null;
}

/**
 * List all valid headerbar network-select option keys.
 * @returns {string[]}
 */
export function getSupportedNetworkSelectKeys() {
  return Object.values(NETWORK_SELECT_KEYS);
}
