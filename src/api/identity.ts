/**
 * Backend identity composition root — wires @arbesk/wallet's verifyAuthProof to
 * the configured viem PublicClient + web3 recovery, and the SUPPORTED_CHAIN_IDS
 * constant. Replaces the old siwe-verify.ts + proof-verify.ts.
 */
import { verifyAuthProof } from "@arbesk/wallet/verify.js";
import type { SignatureVerifier, AuthProof } from "@arbesk/wallet/types.js";
import { verifyMessage } from "viem/actions";
import type { Address, Hex } from "viem";
import { getViemPublicClient, web3 } from "../config.ts";
import { SUPPORTED_CHAIN_IDS } from "../../constants/chains.js";

/**
 * SignatureVerifier over viem + web3 — the only environment-specific bit the
 * shared verifyAuthProof needs.
 */
const verifier: SignatureVerifier = {
  async verifyMessage(address, message, signature, chainId) {
    const client = getViemPublicClient(chainId);
    if (!client) return false;
    return verifyMessage(client, {
      address: address as Address,
      message,
      signature: signature as Hex,
    });
  },
  async recoverAddress(message, signature) {
    return web3.eth.accounts.recover(message, signature);
  },
};

/**
 * Verify a session-creation proof (siwe | oidc) and return the canonical
 * session identity.
 */
export async function verifyProof(
  proof: AuthProof,
  ctx: { expectedDomain?: string } = {},
): Promise<{ valid: boolean; address: string | null; error: string | null }> {
  return verifyAuthProof(proof, {
    verifier,
    supportedChainIds: SUPPORTED_CHAIN_IDS,
    expectedDomain: ctx.expectedDomain,
  });
}
