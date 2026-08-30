/**
 * viem clients for the browser. Reads go through per-chain cached public
 * clients (HTTP RPC); user transactions go through a wallet client wrapping
 * the injected EIP-1193 provider. This module replaces the web3 instances
 * wallet-core used to own.
 *
 * The default chain is the connected wallet's, read from the shared
 * wallet-state store — importing wallet-core here would create an import
 * cycle (wallet-core imports this module's consumers).
 */
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import { getRpcUrl } from "./network-config.ts";
import { walletState } from "../state/wallet-state.ts";

const readClients = new Map<number, PublicClient>();

/**
 * The chain reads default to: the connected wallet's chain, or Hardhat local
 * when disconnected (the dev default, matching getRpcUrl's fallback).
 */
function activeChainId(): number {
  const stored = walletState.get().chainId;
  return stored != null ? Number(stored) : CHAIN_IDS.HARDHAT_LOCAL;
}

/**
 * Cached read client for a chain (default: the active network).
 * @param chainId - chain to read from; defaults to the wallet's active chain
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
