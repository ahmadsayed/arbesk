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

/** Verifies a binding's self-consistency and wallet signature. */
export async function verifyBinding(binding: Binding): Promise<boolean> {
  if (
    !binding ||
    typeof binding.address !== "string" ||
    typeof binding.pubkey !== "string" ||
    typeof binding.signature !== "string"
  ) return false;
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: IDENTITY_MESSAGE,
      signature: binding.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
  return (
    recovered.toLowerCase() === binding.address.toLowerCase() &&
    derivePubkey(binding.signature) === binding.pubkey
  );
}
