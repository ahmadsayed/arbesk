/**
 * Authentication proof verification — the dispatcher for session creation.
 * Accepts a discriminated proof envelope (siwe | oidc) and routes to the
 * right verifier, so wallet (SIWE) and future OAuth/OIDC logins share one
 * session entry point. Moved from src/api/proof-verify.ts.
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
 * Verify an OIDC ID token. Design seam only — not implemented. When OAuth is
 * added, validate the JWT signature against the provider's JWKS, the aud/iss,
 * and the nonce, then return the subject as the identity.
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
