/**
 * Arbesk Shared Backend Configuration
 *
 * Supports multiple networks with per-chain contract addresses,
 * USDC tokens, and RPC URLs. Falls back to legacy env vars for
 * backward compatibility.
 */

import Web3 from "web3";

// ─── Per-Network Configuration ───────────────────────────────────────────────

export const NETWORK_CONFIGS = {
  31415822: {
    name: "Hardhat Local",
    contractAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    usdcToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    rpcUrl: "http://127.0.0.1:8545",
  },
  84532: {
    name: "Base Sepolia",
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    usdcToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpcUrl: "https://sepolia.base.org",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getNetworkConfig(chainId) {
  return NETWORK_CONFIGS[Number(chainId)] || null;
}

export function getContractAddress(chainId) {
  if (chainId) {
    const addr = getNetworkConfig(chainId)?.contractAddress;
    if (addr) return addr;
  }
  return (
    process.env.CONTRACT_ADDRESS ||
    Object.values(NETWORK_CONFIGS)[0]?.contractAddress ||
    null
  );
}

export function getUsdcToken(chainId) {
  if (chainId) {
    const addr = getNetworkConfig(chainId)?.usdcToken;
    if (addr) return addr;
  }
  return process.env.USDC_TOKEN || null;
}

export function getRpcUrl(chainId) {
  if (chainId) {
    const url = getNetworkConfig(chainId)?.rpcUrl;
    if (url) return url;
  }
  return (
    process.env.API_URL ||
    process.env.HARDHAT_RPC_URL ||
    "http://127.0.0.1:8545"
  );
}

// ─── Web3 Instances ──────────────────────────────────────────────────────────

const web3Instances = new Map();

export function getWeb3(chainId) {
  const id = chainId ? Number(chainId) : null;
  if (!id) return web3;
  if (!web3Instances.has(id)) {
    web3Instances.set(id, new Web3(getRpcUrl(id)));
  }
  return web3Instances.get(id);
}

// ─── Legacy Exports (backward compatible) ────────────────────────────────────

export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
export const ASSETS_IPFS = process.env.ASSETS_IPFS;
export const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
export const HARDHAT_RPC_URL =
  process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
export const API_URL = process.env.API_URL || HARDHAT_RPC_URL;

// Default shared Web3 instance (Hardhat local or env-configured RPC)
export const web3 = new Web3(API_URL);
