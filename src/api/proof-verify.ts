/**
 * Authentication proof verification — the backend dispatcher for session
 * creation. Accepts a discriminated proof envelope and routes to the right
 * verifier, so wallet (SIWE) and future OAuth/OIDC logins share one session
 * entry point.
 *
 * Proof shapes (see `src/api/schemas.ts`):
 *   { kind: "siwe", message, signature, eoaAddress? }
 *   { kind: "oidc", provider, idToken, nonce? }
 */

import { verifySiwe } from "./siwe-verify.ts";

export interface VerifyProofResult {
  valid: boolean;
  /** Canonical session identity (an address for SIWE; an OIDC subject later). */
  address: string | null;
  error: string | null;
}

/**
 * Verify an OIDC ID token. Design seam only — not implemented. When OAuth is
 * added, this must validate the JWT signature against the provider's JWKS,
 * the `aud`/`iss`, and the nonce, then return the subject as the identity.
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
 * @param proof - discriminated union from `createSessionSchema`
 * @param ctx.expectedDomain - the request Host, used to bind SIWE messages
 */
export async function verifyProof(
  proof: { kind: "siwe" | "oidc" } & Record<string, unknown>,
  { expectedDomain }: { expectedDomain?: string } = {},
): Promise<VerifyProofResult> {
  if (proof.kind === "siwe") {
    return verifySiwe(proof.message as string, proof.signature as string, {
      expectedDomain,
      eoaAddress: proof.eoaAddress as string | undefined,
    });
  }

  if (proof.kind === "oidc") {
    return verifyOidc(proof as unknown as {
      provider: string;
      idToken: string;
      nonce?: string;
    });
  }

  return { valid: false, address: null, error: "Unknown proof kind" };
}
