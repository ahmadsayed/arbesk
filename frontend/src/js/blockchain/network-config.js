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

export const NETWORK_CONFIGS = {
  31415822: {
    name: "Hardhat Local",
    chainId: 31415822,
    contractAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    usdcToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorer: null,
  },
  84532: {
    name: "Base Sepolia",
    chainId: 84532,
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    usdcToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
