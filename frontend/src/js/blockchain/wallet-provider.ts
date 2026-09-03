/**
 * Shared wallet connection state — leaf module.
 * @remarks Holds the provider reference and network definitions, and stays
 *   import-free of consumers to avoid an import cycle.
 */

import { CHAIN_IDS } from "../../../../constants/chains.js";

// ─── Network definitions (shared by wallet-core.ts and wallet-network.ts) ───

export const NETWORKS = {
  hardhat: {
    chainId: `0x${CHAIN_IDS.HARDHAT_LOCAL.toString(16)}`,
    chainName: "Hardhat Local",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: [] as string[],
  },
  baseSepolia: {
    chainId: `0x${CHAIN_IDS.BASE_TESTNET.toString(16)}`,
    chainName: "Base Sepolia Testnet",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
};

// ─── Live EIP-1193 provider ───

/** The connected wallet's provider, or null when disconnected. */
export let web3Provider: any = null;

/** Sets the connected wallet's provider. */
export function setWeb3Provider(provider: any): void {
  web3Provider = provider;
}
