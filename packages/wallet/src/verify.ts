/**
 * Authentication proof verification — the dispatcher for session creation.
 * @remarks A discriminated proof envelope (siwe | oidc) routes to one verifier,
 *   so wallet (SIWE) and future OAuth/OIDC logins share one entry point.
 */
import { verifySiwe } from "./siwe.ts";
import type { AuthProof, SignatureVerifier } from "./types.ts";

export interface VerifyProofResult {
  valid: boolean;
  /** Canonical session identity (an address for SIWE; an OIDC subject later). */
  address: string | null;
  error: string | null;
}

export interface VerifyProofContext {
  verifier: SignatureVerifier;
  supportedChainIds: number[];
  expectedDomain?: string;
}

/**
 * Verifies an OIDC ID token — design seam only, not implemented.
 */
async function verifyOidc(proof: {
  provider: string;
  idToken: string;
  nonce?: string;
}): Promise<VerifyProofResult> {
  void proof;
  return {
    valid: false,
    address: null,
    error: `OIDC sign-in is not implemented yet (provider=${proof.provider})`,
  };
}

/**
 * Verify a session-creation proof.
 */
export async function verifyAuthProof(
  proof: AuthProof,
  ctx: VerifyProofContext,
): Promise<VerifyProofResult> {
  if (proof.kind === "siwe") {
    return verifySiwe(proof.message, proof.signature, {
      expectedDomain: ctx.expectedDomain,
      eoaAddress: proof.eoaAddress,
      verifier: ctx.verifier,
      supportedChainIds: ctx.supportedChainIds,
    });
  }

  if (proof.kind === "oidc") {
    return verifyOidc(proof);
  }

  return { valid: false, address: null, error: "Unknown proof kind" };
}
