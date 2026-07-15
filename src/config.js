/**
 * Arbesk Shared Backend Configuration
 *
 * Supports multiple networks with per-chain contract addresses,
 * USDC tokens, and RPC URLs. Falls back to legacy env vars for
 * backward compatibility.
 */

import Web3 from "web3";
import http_ from "http";
import https_ from "https";
import { createPublicClient, http } from "viem";
import { CHAIN_IDS } from "../constants/chains.js";

// TypeScript sees the default import as the module namespace under NodeNext,
// so alias it to any for construction while keeping the runtime default import.
/** @type {any} */
const Web3Ctor = Web3;

// Keep-alive agents shared across all web3 instances. Public RPCs behind
// Cloudflare (sepolia.base.org) throttle repeated fresh TLS handshakes, which
// intermittently kills web3's per-request connections with ETIMEDOUT;
// reusing sockets avoids the handshake churn entirely.
const httpKeepAliveAgent = new http_.Agent({ keepAlive: true });
const httpsKeepAliveAgent = new https_.Agent({ keepAlive: true });

/** @param {string} rpcUrl */
function makeWeb3(rpcUrl) {
  const HttpProvider = Web3Ctor.providers?.HttpProvider ?? Web3Ctor.HttpProvider;
  if (!HttpProvider) {
    // Test mocks may only expose the default constructor.
    return new Web3Ctor(rpcUrl);
  }
  const agent = rpcUrl.startsWith("https")
    ? httpsKeepAliveAgent
    : httpKeepAliveAgent;
  const provider = new HttpProvider(rpcUrl, {
    providerOptions: /** @type {any} */ ({ agent }),
  });
  return new Web3Ctor(provider);
}

// ─── Per-Network Configuration ───────────────────────────────────────────────

/** @type {Record<number, {name: string; contractAddress: string; paidContractAddress: string | null; usdcToken: string | null; rpcUrl: string}>} */
export const NETWORK_CONFIGS = {
  [CHAIN_IDS.HARDHAT_LOCAL]: {
    name: "Hardhat Local",
    contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    paidContractAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    usdcToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    rpcUrl: "http://127.0.0.1:8545",
  },
  ...(process.env.INDEXER_DISABLE_TESTNET
    ? {}
    : {
        [CHAIN_IDS.BASE_TESTNET]: {
          name: "Base Sepolia Testnet",
          contractAddress:
            process.env.BASE_CONTRACT_ADDRESS ||
            "0xE3d99B0FfF7c3dc33e324C9375b5A83ED4cE6deC",
          paidContractAddress: null, // Paid tier not deployed on testnet
          usdcToken: null, // USDC not deployed on testnet
          rpcUrl: "https://sepolia.base.org",
        },
      }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** @param {any} chainId */
export function getNetworkConfig(chainId) {
  return NETWORK_CONFIGS[Number(chainId)] || null;
}

/** @param {any} chainId */
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

/** @param {any} chainId */
export function getUsdcToken(chainId) {
  if (chainId) {
    const addr = getNetworkConfig(chainId)?.usdcToken;
    if (addr) return addr;
  }
  return process.env.USDC_TOKEN || null;
}

/** @param {any} chainId */
export function getRpcUrl(chainId) {
  const envUrl = process.env.API_URL || process.env.HARDHAT_RPC_URL;
  if (chainId) {
    const cfg = getNetworkConfig(chainId);
    if (cfg) {
      // For local/dev networks, allow env override so parallel E2E stacks
      // (each on its own Hardhat port) can point each backend at its own node.
      if (cfg.name === "Hardhat Local" && envUrl) return envUrl;
      if (cfg.rpcUrl) return cfg.rpcUrl;
    }
  }
  return envUrl || "http://127.0.0.1:8545";
}

// ─── Web3 Instances ──────────────────────────────────────────────────────────

const web3Instances = new Map();
const viemClients = new Map();

/** @param {any} chainId */
export function getWeb3(chainId) {
  const id = chainId ? Number(chainId) : null;
  if (!id) return web3;
  if (!web3Instances.has(id)) {
    web3Instances.set(id, makeWeb3(getRpcUrl(id)));
  }
  return web3Instances.get(id);
}

/**
 * Get a viem public client for the given chain.
 * Used for ERC-6492 / EIP-1271 universal signature verification.
 * @param {any} chainId
 * @returns {import("viem").PublicClient | null}
 */
export function getViemPublicClient(chainId) {
  const id = chainId ? Number(chainId) : null;
  if (!id) return null;
  if (!viemClients.has(id)) {
    const rpcUrl = getRpcUrl(id);
    viemClients.set(
      id,
      createPublicClient({
        transport: http(rpcUrl),
      }),
    );
  }
  return viemClients.get(id);
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
export const web3 = makeWeb3(API_URL);
