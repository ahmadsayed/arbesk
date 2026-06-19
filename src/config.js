/**
 * Arbesk Shared Backend Configuration
 *
 * Supports multiple networks with per-chain contract addresses,
 * USDC tokens, and RPC URLs. Falls back to legacy env vars for
 * backward compatibility.
 */

import Web3 from "web3";
import { CHAIN_IDS } from "./constants/chains.js";

// ─── Per-Network Configuration ───────────────────────────────────────────────

export const NETWORK_CONFIGS = {
  [CHAIN_IDS.HARDHAT_LOCAL]: {
    name: "Hardhat Local",
    contractAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    paidContractAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    usdcToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    rpcUrl: "http://127.0.0.1:8545",
  },
  [CHAIN_IDS.OPTIMISM_SEPOLIA]: {
    name: "Optimism Sepolia",
    contractAddress: "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B",
    paidContractAddress: "0x3Fc0f8CBe88D8aB0918EAe5457dd6E5dD9A23673",
    usdcToken: "0x5fd84259d66Cd461235407180D3B4c8d0F273e15", // Circle USDC on OP Sepolia
    rpcUrl: "https://sepolia.optimism.io",
  },
  [CHAIN_IDS.OPTIMISM_MAINNET]: {
    name: "Optimism Mainnet",
    contractAddress: null, // Deploy free contract to Optimism mainnet first
    paidContractAddress: null, // Deploy paid contract to Optimism mainnet first
    usdcToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // Circle USDC on OP Mainnet
    rpcUrl: "https://mainnet.optimism.io",
  },
  [CHAIN_IDS.SEI_TESTNET]: {
    name: "SEI Testnet",
    contractAddress: "0x38BC6BabC907783f92CE1766F98494578ED2a5b2",
    paidContractAddress: "0x0B7E171c2A98Af2CaD02B12c347997F769e336c2",
    usdcToken: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED", // Circle USDC on SEI testnet
    rpcUrl: "https://evm-rpc-testnet.sei-apis.com",
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
export const NOSTR_RELAY_URL =
  process.env.NOSTR_RELAY_URL || "ws://127.0.0.1:7777";
export const NOSTR_SERVICE_PRIVATE_KEY = process.env.NOSTR_SERVICE_PRIVATE_KEY;

// Default shared Web3 instance (Hardhat local or env-configured RPC)
export const web3 = new Web3(API_URL);
