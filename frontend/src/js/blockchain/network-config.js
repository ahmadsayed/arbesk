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
    contractAddress: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    paidContractAddress: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    usdcToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorer: null,
  },
  [CHAIN_IDS.OPTIMISM_SEPOLIA]: {
    name: "Optimism Sepolia",
    chainId: CHAIN_IDS.OPTIMISM_SEPOLIA,
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    paidContractAddress: "0x3Fc0f8CBe88D8aB0918EAe5457dd6E5dD9A23673",
    usdcToken: "0x5fd84259d66Cd461235407180D3B4c8d0F273e15", // Circle USDC on OP Sepolia
    rpcUrl: "https://sepolia.optimism.io",
    blockExplorer: "https://sepolia-optimism.etherscan.io",
  },
  [CHAIN_IDS.OPTIMISM_MAINNET]: {
    name: "Optimism Mainnet",
    chainId: CHAIN_IDS.OPTIMISM_MAINNET,
    contractAddress: null, // Free tier not yet deployed to Optimism mainnet
    paidContractAddress: null, // Paid tier not yet deployed to Optimism mainnet
    usdcToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // Circle USDC on OP Mainnet
    rpcUrl: "https://mainnet.optimism.io",
    blockExplorer: "https://optimistic.etherscan.io",
  },
  [CHAIN_IDS.SEI_TESTNET]: {
    name: "SEI Testnet",
    chainId: CHAIN_IDS.SEI_TESTNET,
    contractAddress: "0x38BC6BabC907783f92CE1766F98494578ED2a5b2",
    paidContractAddress: "0x0B7E171c2A98Af2CaD02B12c347997F769e336c2",
    usdcToken: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", // Circle USDC on SEI testnet
    rpcUrl: "https://evm-rpc-testnet.sei-apis.com",
    blockExplorer: "https://testnet.seiscan.io",
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
  return (
    getNetworkConfig(chainId)?.rpcUrl || "http://127.0.0.1:8545"
  );
}

/**
 * List all supported chain IDs.
 * @returns {number[]}
 */
export function getSupportedChainIds() {
  return Object.keys(NETWORK_CONFIGS).map(Number);
}

// Attach to window for console debugging
if (typeof window !== "undefined") {
  window.NETWORK_CONFIGS = NETWORK_CONFIGS;
  window.getNetworkConfig = getNetworkConfig;
  window.getContractAddress = getContractAddress;
}
