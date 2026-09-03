/**
 * Port + config types for @arbesk/wallet. No runtime code here.
 * @remarks SessionStore and SignatureVerifier are the environment seams.
 */

// ─── On-chain signer ────────────────────────────────────────────────────────

export type SignerSource = "eoa" | "cdp";

/** A mined transaction result. status is null when unknown/not-yet-known. */
export interface MinedReceipt {
  /** On-chain transaction hash (not a UserOperation hash). */
  transactionHash: string;
  /** true = success, false = revert, null = unknown. */
  status: boolean | null;
  /** Block number the tx was included in (null/absent when unknown). */
  blockNumber?: number | null;
}

/**
 * The result of Signer.sendTransaction.
 * @remarks Resolves as soon as the transaction is broadcast (never blocks on
 *   mining); wait() blocks until inclusion.
 */
export interface SendResult {
  /** Hash the wallet broadcast: EVM tx hash (EOA) or UserOperation hash (CDP). */
  hash: string;
  /** Wait for inclusion and resolve the mined receipt. */
  wait(): Promise<MinedReceipt>;
}

/**
 * On-chain signing & sending capability.
 * @remarks getAddress and getSignerAddress differ only for CDP smart accounts
 *   (owner vs embedded EOA); for an EOA they are the same key.
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
  /** Canonical id: an Ethereum address (wallet) or an OIDC sub. */
  id: string;
  kind: "ethereum-address" | "oauth-subject";
  displayName: string;
  email?: string;
}

/**
 * A proof that authenticates a user, exchanged for a session.
 */
export type AuthProof =
  | { kind: "siwe"; message: string; signature: string; eoaAddress?: string }
  | { kind: "oidc"; provider: string; idToken: string; nonce?: string };

/**
 * An identity/auth mechanism.
 * @remarks A mechanism does NOT imply on-chain signing; that capability is the
 *   separate Signer.
 */
export interface AuthMechanism {
  /** Stable id: "eoa" | "cdp" | "oauth-google" | ... */
  id: string;
  authenticate(): Promise<AuthProof>;
  restoreSilently(): Promise<AuthProof | null>;
  signOut(): Promise<void>;
  getIdentity(): UserIdentity | null;
}

// ─── Session store (environment seam) ───────────────────────────────────────

export interface SessionStore {
  create(address: string): { token: string; expiresAt: number };
  validate(token: string): string | null;
  invalidate(token: string): void;
}

// ─── Signature verification (environment seam) ──────────────────────────────

/**
 * EIP-191 signature verification + recovery.
 * @remarks The frontend leaves this null (it only builds proofs).
 */
export interface SignatureVerifier {
  verifyMessage(address: string, message: string, signature: string, chainId: number): Promise<boolean>;
  recoverAddress(message: string, signature: string): Promise<string>;
}
