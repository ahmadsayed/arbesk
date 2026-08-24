/**
 * Wallet & identity ports.
 *
 * These interfaces are the DI seam for the wallet layer, mirroring the
 * port-and-adapter pattern used everywhere else in asset-core. The concrete
 * wallet code (EOA via injected/WalletConnect, CDP email smart accounts) and
 * future auth mechanisms (OAuth/OIDC) implement these and are injected at the
 * composition root — nothing in the app should branch on wallet *kind*.
 *
 * The key split: **identity/auth** (`AuthMechanism` — "who are you, prove it")
 * is separate from **on-chain signing** (`Signer` — "sign & send on-chain").
 * A login method may provide a Signer (EOA, CDP) or not (pure OAuth), so the
 * Signer is an optional capability, not part of identity.
 */

// ─── On-chain signer ────────────────────────────────────────────────────────

export type SignerSource = "eoa" | "cdp";

/** A mined transaction result. `status` is null when unknown/not-yet-known. */
export interface MinedReceipt {
  /** On-chain transaction hash (not a UserOperation hash). */
  transactionHash: string;
  /** true = success, false = revert, null = unknown. */
  status: boolean | null;
  /** Block number the tx was included in (null/absent when unknown). */
  blockNumber?: number | null;
}

/**
 * The result of `Signer.sendTransaction`. Resolves as soon as the transaction
 * is *broadcast* (never blocks on mining), so callers can fire optimistic UI
 * immediately. `wait()` blocks until block inclusion and yields the real
 * on-chain transaction hash + status.
 */
export interface SendResult {
  /** Hash the wallet broadcast: EVM tx hash (EOA) or UserOperation hash (CDP). */
  hash: string;
  /** Wait for inclusion and resolve the mined receipt. */
  wait(): Promise<MinedReceipt>;
}

/**
 * On-chain signing & sending capability. The on-chain *owner* address
 * (`getAddress`) and the *signer* address (`getSignerAddress`) differ only for
 * CDP smart accounts (owner = smart account, signer = embedded EOA); for an
 * EOA they are the same key.
 */
export interface Signer {
  source: SignerSource;
  /** On-chain owner address (smart account for CDP, the EOA itself otherwise). */
  getAddress(): string;
  /** Address whose key actually signs (== getAddress() for an EOA). */
  getSignerAddress(): string;
  getChainId(): Promise<number>;
  /** Sign an arbitrary UTF-8 message (EIP-191 personal_sign semantics). */
  signMessage(message: string): Promise<string>;
  /** Send a transaction (broadcast only; use SendResult.wait() to await). */
  sendTransaction(tx: {
    to: string;
    value?: bigint | string;
    data?: string;
    /** Optional gas limit. CDP ignores it (sponsored UserOps); EOA uses it. */
    gas?: number | bigint | string;
  }): Promise<SendResult>;
}

// ─── Identity & authentication ──────────────────────────────────────────────

export interface UserIdentity {
  /** Canonical id: an Ethereum address (wallet) or an OIDC `sub`. */
  id: string;
  kind: "ethereum-address" | "oauth-subject";
  /** Human-readable label: email, short address, or name. */
  displayName: string;
  email?: string;
}

/**
 * A proof that authenticates a user, exchanged by the backend for a session.
 * `siwe` (EIP-4361) for wallet mechanisms; `oidc` (an ID token) for
 * OAuth/OIDC mechanisms.
 */
export type AuthProof =
  | { kind: "siwe"; message: string; signature: string; eoaAddress?: string }
  | { kind: "oidc"; provider: string; idToken: string; nonce?: string };

/**
 * An identity/auth mechanism — how a user logs in and proves who they are.
 * Concrete instances: EOA (SIWE), CDP (email OTP → SIWE via embedded EOA),
 * and OAuth/OIDC (ID token). A mechanism does NOT imply on-chain signing;
 * that capability is the separate `Signer`.
 */
export interface AuthMechanism {
  /** Stable id: "eoa" | "cdp" | "oauth-google" | "oauth-apple" | … */
  id: string;
  /** Interactive sign-in (popup / OTP / redirect). Resolves an AuthProof. */
  authenticate(): Promise<AuthProof>;
  /** Silent restore (no popup); resolves null when no live session. */
  restoreSilently(): Promise<AuthProof | null>;
  signOut(): Promise<void>;
  getIdentity(): UserIdentity | null;
}
