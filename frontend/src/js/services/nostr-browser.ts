import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { createNostrFacade } from "@arbesk/nostr";
import type { Binding, NostrFacade, WalletSignPort, ChainReadPort, RelayPort } from "@arbesk/nostr";
import { getSigner } from "../blockchain/wallet.ts";
import { getReadClient } from "../blockchain/viem-clients.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { walletState } from "../state/wallet-state.ts";
import { buildEditorProof } from "@arbesk/asset-core/domain/editors.js";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";

const OWNER_ABI = [{
  inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
  name: "ownerOf", outputs: [{ internalType: "address", name: "", type: "address" }],
  stateMutability: "view", type: "function",
}] as const;

const pool = new SimplePool();

const signerPort: WalletSignPort = {
  signMessage: async (m) => {
    const signer = getSigner();
    if (!signer) throw new Error("no signer");
    return signer.signMessage(m);
  },
};

const chainPort: ChainReadPort = {
  isTokenAuthor: isTokenAuthor,
};

const relayPort: RelayPort = {
  publish: async (event: NostrEvent) => {
    await pool.publish([NOSTR_RELAY_URL], event);
  },
};

/** Owner or Merkle-editor check for a token. */
export async function isTokenAuthor(
  chainId: number, tokenId: string, address: string
): Promise<boolean> {
  try {
    const contract = getContractAddress(chainId);
    const owner = await getReadClient(chainId).readContract({
      address: contract as `0x${string}`,
      abi: OWNER_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    if ((owner as string).toLowerCase() === address.toLowerCase()) return true;
    const proof = await buildEditorProof(tokenId, address);
    return proof != null;
  } catch {
    return false;
  }
}

export async function getTokenOwner(chainId: number, tokenId: string): Promise<string | null> {
  try {
    const contract = getContractAddress(chainId);
    const owner = await getReadClient(chainId).readContract({
      address: contract as `0x${string}`,
      abi: OWNER_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    return (owner as string).toLowerCase();
  } catch {
    return null;
  }
}

export function getNostrFacade(): NostrFacade {
  return createNostrFacade({ signer: signerPort, chain: chainPort, relay: relayPort });
}

function bindingKey(address: string): string {
  return `arbesk-nostr-binding-${address.toLowerCase()}`;
}

/** The connected wallet's binding, created (once) from a wallet signature. */
export async function getOrCreateBinding(): Promise<Binding | null> {
  const address = walletState.get().walletAddress;
  if (!address) return null;
  const cached = localStorage.getItem(bindingKey(address));
  if (cached) {
    try { return JSON.parse(cached) as Binding; } catch { /* re-create */ }
  }
  const binding = await getNostrFacade().createIdentity();
  localStorage.setItem(bindingKey(address), JSON.stringify(binding));
  return binding;
}
