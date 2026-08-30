/**
 * Shared wallet connection state — leaf module.
 *
 * Holds the EIP-1193 provider reference and the wallet_addEthereumChain
 * network definitions shared by wallet-core (writer) and wallet-network
 * (reader). Kept import-free of both so wallet-network doesn't have to
 * import wallet-core (which dynamic-imports wallet-network back — a cycle).
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

/** Called by wallet-core whenever the active provider changes. */
export function setWeb3Provider(provider: any): void {
  web3Provider = provider;
}
