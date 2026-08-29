/**
 * Arbesk Shared Backend Configuration
 *
 * Supports multiple networks with per-chain contract addresses,
 * USDC tokens, and RPC URLs. Falls back to legacy env vars for
 * backward compatibility.
 */

import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { CHAIN_IDS } from "../constants/chains.js";

const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID || 84532);

// ─── Per-Network Configuration ───────────────────────────────────────────────

interface NetworkConfig {
  name: string;
  contractAddress: string;
  paidContractAddress: string | null;
  usdcToken: string | null;
  rpcUrl: string;
}

export const NETWORK_CONFIGS: Record<number, NetworkConfig> = {
  [CHAIN_IDS.HARDHAT_LOCAL]: {
    name: "Hardhat Local",
    contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    paidContractAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    usdcToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    rpcUrl: "http://127.0.0.1:8545",
  },
  // INDEXER_DISABLE_TESTNET: intentional kill-switch (set nowhere by default).
  // Set it to any non-empty value to drop Base Sepolia from NETWORK_CONFIGS,
  // e.g. to keep a local-only backend from indexing the public testnet.
  ...(process.env.INDEXER_DISABLE_TESTNET
    ? {}
    : {
        [CHAIN_IDS.BASE_TESTNET]: {
          name: "Base Sepolia Testnet",
          contractAddress:
            process.env.BASE_CONTRACT_ADDRESS ||
            "0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8",
          paidContractAddress: null, // Paid tier not deployed on testnet
          usdcToken: null, // USDC not deployed on testnet
          rpcUrl: "https://sepolia.base.org",
        },
      }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getNetworkConfig(chainId: any): NetworkConfig | null {
  return NETWORK_CONFIGS[Number(chainId)] || null;
}

export function getContractAddress(chainId: any): string | null {
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

/**
 * Return the chain's configured Arbesk contract set: the free-tier contract
 * first, then the paid-tier contract when configured for that chain. For the
 * default/unknown chain this falls back to the single address
 * `getContractAddress()` would resolve (env override or first network).
 * Used to allowlist caller-supplied contract addresses and to try both tiers
 * when the caller does not specify one.
 */
export function getConfiguredContracts(chainId: any): string[] {
  const cfg = getNetworkConfig(chainId);
  const addrs = cfg
    ? [cfg.contractAddress, cfg.paidContractAddress]
    : [getContractAddress(chainId)];
  const seen: string[] = [];
  for (const addr of addrs) {
    if (!addr) continue;
    if (!seen.some((a) => a.toLowerCase() === addr.toLowerCase())) {
      seen.push(addr);
    }
  }
  return seen;
}

export function getRpcUrl(chainId: any): string {
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

// ─── Chain Clients ───────────────────────────────────────────────────────────

// One cached viem PublicClient per chain id, built on the configured RPC URL.
// viem's http transport uses undici fetch, which keeps connections alive by
// default — no explicit keep-alive agent is needed (unlike the old web3
// providers, which required one to survive Cloudflare TLS-handshake throttling
// on sepolia.base.org).
const publicClients = new Map<number, PublicClient>();

export function getPublicClient(chainId?: number): PublicClient {
  const id = chainId ?? DEFAULT_CHAIN_ID;
  let c = publicClients.get(id);
  if (!c) {
    c = createPublicClient({ transport: http(getRpcUrl(id)) });
    publicClients.set(id, c);
  }
  return c;
}

/**
 * Get a viem public client for the given chain.
 * Used for ERC-6492 / EIP-1271 universal signature verification.
 * Thin wrapper over getPublicClient that returns null (instead of the
 * default-chain client) when no chain id is given.
 */
export function getViemPublicClient(chainId: any): PublicClient | null {
  const id = chainId ? Number(chainId) : null;
  if (!id) return null;
  return getPublicClient(id);
}

// ─── Legacy Exports (backward compatible) ────────────────────────────────────

export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
export const HARDHAT_RPC_URL =
  process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
export const API_URL = process.env.API_URL || HARDHAT_RPC_URL;
export const NOSTR_RELAY_URL =
  process.env.NOSTR_RELAY_URL || "ws://127.0.0.1:7777";
export const NOSTR_SERVICE_PRIVATE_KEY = process.env.NOSTR_SERVICE_PRIVATE_KEY;
