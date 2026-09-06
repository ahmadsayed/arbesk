/**
 * Read-only contract access for chain reads that must also work without a
 * connected wallet (public profile pages, anonymous Studio deep links).
 * @remarks Leaf module: composes network-config (static per-chain address),
 *   viem-clients (read client), and backend-client (unauthenticated artifact
 *   endpoint). Uses the walletState contract mirror rather than wallet-core's
 *   getActiveContract() so engine/ consumers don't pull in the wallet stack.
 */

import { getContract } from "viem";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import { walletState } from "../state/wallet-state.ts";
import { getContractAddress } from "./network-config.ts";
import { getReadClient } from "./viem-clients.ts";
import { getContractArtifact } from "../services/backend-client.ts";

/** Lazily built read-only contracts, per chain. */
const _readableContractCache = new Map<number, any>();

/**
 * Contract instance for chain READS. Returns the wallet-driven instance when
 * one exists AND no other chain was requested; otherwise lazily builds a
 * read-only viem contract from the static per-chain address plus the
 * unauthenticated artifact endpoint, cached per chain. Returns null when no
 * address or ABI is available.
 * @param chainId - explicit read chain (cross-chain profile views); defaults
 *   to the connected wallet's chain, or Hardhat local when disconnected
 */
export async function getReadableContract(
  chainId?: number
): Promise<any | null> {
  const id = Number(
    chainId ?? walletState.get().chainId ?? CHAIN_IDS.HARDHAT_LOCAL
  );
  const walletChain = Number(walletState.get().chainId);
  const active = walletState.get().contract;
  // The wallet contract is bound to the wallet's chain — never serve it for
  // an explicit cross-chain read.
  if (active && (!chainId || walletChain === id)) return active;
  const cached = _readableContractCache.get(id);
  if (cached) return cached;
  const address = getContractAddress(id);
  if (!address) return null;
  const artifact = await getContractArtifact("ArbeskAssetFree");
  if (!artifact?.abi) return null;
  const instance = getContract({
    address: address as `0x${string}`,
    abi: artifact.abi,
    client: getReadClient(id),
  });
  _readableContractCache.set(id, instance);
  return instance;
}
