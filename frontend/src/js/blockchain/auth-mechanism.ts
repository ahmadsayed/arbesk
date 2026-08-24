/**
 * Authentication mechanism helpers.
 *
 * The identity/auth half of the wallet/identity split. Wallet logins (EOA and
 * CDP) both produce a SIWE `AuthProof` — they differ only in the injected
 * `Signer` (whose `getSignerAddress()` is the EOA for both). A future OAuth
 * mechanism would produce an `oidc` proof instead, reusing the same
 * `AuthMechanism`/`AuthProof` contract in `wallet-ports.ts`.
 */
import type { AuthProof, Signer, UserIdentity } from "./wallet-ports.ts";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Build the `UserIdentity` for a connected wallet. Identity is the *who*, the
 * `Signer` is the *how-on-chain* — they are stored separately so an OAuth
 * login can have identity without a signer.
 */
export function buildUserIdentity(opts: {
  address: string;
  email?: string | null;
  source: "cdp" | "walletconnect" | "injected" | null;
}): UserIdentity {
  return {
    id: opts.address.toLowerCase(),
    kind: "ethereum-address",
    displayName: opts.email || shortAddress(opts.address),
    email: opts.email || undefined,
  };
}

/**
 * Build and sign a SIWE `AuthProof` (EIP-4361) for the given signer. This is
 * the wallet `AuthMechanism`'s authenticate step: the message's `address` is
 * the on-chain owner, and `eoaAddress` carries the key that actually signed
 * (== the owner for an EOA; the embedded EOA for a CDP smart account).
 */
export async function buildSiweAuthProof(opts: {
  signer: Signer;
  address: string;
  chainId: number;
  domain: string;
  statement?: string;
}): Promise<AuthProof> {
  const { buildSiweMessage, generateNonce } = await import("./siwe.ts");
  const nonce = generateNonce();
  const message = buildSiweMessage(
    opts.domain,
    opts.address,
    nonce,
    opts.chainId,
    opts.statement,
  );
  const signature = await opts.signer.signMessage(message);
  return {
    kind: "siwe",
    message,
    signature,
    eoaAddress: opts.signer.getSignerAddress(),
  };
}
