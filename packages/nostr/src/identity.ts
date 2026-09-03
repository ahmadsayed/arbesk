import { hexToBytes, keccak256, recoverMessageAddress } from "viem";
import { getPublicKey } from "nostr-tools";
import type { Binding, WalletSignPort } from "./types.ts";
import { IDENTITY_MESSAGE } from "./kinds.ts";

/** The Nostr secret key is the keccak256 of the wallet's binding signature. */
export function deriveSecretKey(signature: string): string {
  return keccak256(signature as `0x${string}`).slice(2);
}

/** The Nostr pubkey derived from the wallet's binding signature. */
export function derivePubkey(signature: string): string {
  return getPublicKey(hexToBytes(`0x${deriveSecretKey(signature)}` as `0x${string}`));
}

/** Signs the fixed identity message and returns the wallet↔Nostr binding. */
export async function buildBinding(signer: WalletSignPort): Promise<Binding> {
  const signature = await signer.signMessage(IDENTITY_MESSAGE);
  const address = await recoverMessageAddress({
    message: IDENTITY_MESSAGE,
    signature: signature as `0x${string}`,
  });
  return { address, pubkey: derivePubkey(signature), signature };
}
