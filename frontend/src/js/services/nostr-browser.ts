import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { createNostrFacade } from "@arbesk/nostr";
import type { Binding, NostrFacade, WalletSignPort, ChainReadPort, RelayPort } from "@arbesk/nostr";
import { getSigner } from "../blockchain/wallet.ts";
import { walletState } from "../state/wallet-state.ts";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";

const pool = new SimplePool();

const signerPort: WalletSignPort = {
  signMessage: async (m) => {
    const signer = getSigner();
    if (!signer) throw new Error("no signer");
    return signer.signMessage(m);
  },
};

// The live-update flow no longer verifies the signer (the chain is the source
// of truth), so the chain port is a no-op stub kept only to satisfy the facade.
const chainPort: ChainReadPort = { isTokenAuthor: async () => false };

const relayPort: RelayPort = {
  publish: async (event: NostrEvent) => {
    await Promise.all(pool.publish([NOSTR_RELAY_URL], event));
  },
};

export function getNostrFacade(): NostrFacade {
  return createNostrFacade({ signer: signerPort, chain: chainPort, relay: relayPort });
}

function bindingKey(address: string): string {
  return `arbesk-nostr-binding-${address.toLowerCase()}`;
}

/** The connected wallet's signing key material, created once from a wallet signature. */
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
