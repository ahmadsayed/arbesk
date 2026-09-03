/**
 * viem clients for the browser: cached public clients for reads, and a wallet
 * client wrapping the injected EIP-1193 provider for user transactions.
 * @remarks The default chain is the connected wallet's, read from wallet-state;
 *   importing wallet-core here would create an import cycle.
 */
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import { getRpcUrl } from "./network-config.ts";
import { walletState } from "../state/wallet-state.ts";

const readClients = new Map<number, PublicClient>();

/**
 * The chain reads default to the connected wallet's chain, or Hardhat local
 * (the dev default) when disconnected.
 */
function activeChainId(): number {
  const stored = walletState.get().chainId;
  return stored != null ? Number(stored) : CHAIN_IDS.HARDHAT_LOCAL;
}

/**
 * Cached read client for a chain (default: the active network).
 */
export function getReadClient(chainId?: number): PublicClient {
  const id = chainId ?? activeChainId();
  let c = readClients.get(id);
  if (!c) {
    c = createPublicClient({ transport: http(getRpcUrl(id)) });
    readClients.set(id, c);
  }
  return c;
}
