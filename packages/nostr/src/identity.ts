import { keccak256 } from "viem";
import type { Hex } from "viem";
import type { Binding, WalletSignPort } from "./types.ts";
import { IDENTITY_MESSAGE } from "./kinds.ts";

/** The Nostr secret key is the keccak256 of the wallet's signing signature. */
export function deriveSecretKey(signature: string): string {
  return keccak256(signature as Hex).slice(2);
}

/** Signs the fixed identity message and returns the signing key material. */
export async function buildBinding(signer: WalletSignPort): Promise<Binding> {
  const signature = await signer.signMessage(IDENTITY_MESSAGE);
  return { signature };
}
