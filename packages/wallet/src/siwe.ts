/**
 * SIWE (EIP-4361) build + verify — the single shared contract.
 * @remarks Both halves live in one module so the emitted message round-trips
 *   through verification by construction.
 */
import { SiweMessage, generateNonce } from "siwe";
import { getAddress } from "viem/utils";
import type { Address } from "viem";
import type { SignatureVerifier } from "./types.ts";

export { generateNonce };

const DEFAULT_STATEMENT = "Sign in to Arbesk Studio";
const DEFAULT_MESSAGE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Build (browser) ────────────────────────────────────────────────────────

/**
 * Build a standard EIP-4361 SIWE message.
 */
export function buildSiweMessage(
  domain: string,
  address: string,
  nonce: string,
  chainId: number,
  statement = DEFAULT_STATEMENT,
): string {
  return new SiweMessage({
    domain,
    address: getAddress(address as Address),
    statement,
    uri: typeof window !== "undefined" ? window.location.origin : "",
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
  }).toMessage();
}

// ─── Verify (backend) ───────────────────────────────────────────────────────

/** Structured fields parsed out of a SIWE message. */
export interface ParsedSiweMessage {
  domain: string;
  address: string;
  statement: string | undefined;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string | undefined;
}

export function parseSiweMessage(message: string): ParsedSiweMessage | null {
  if (!message || typeof message !== "string") return null;
  try {
    const parsed = new SiweMessage(message);
    return {
      domain: parsed.domain,
      address: parsed.address,
      statement: parsed.statement,
      uri: parsed.uri,
      version: parsed.version,
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

export interface VerifySiweResult {
  valid: boolean;
  address: string | null;
  error: string | null;
}

export interface VerifySiweContext {
  verifier: SignatureVerifier;
  supportedChainIds: number[];
  expectedDomain?: string;
  eoaAddress?: string;
  messageMaxAgeMs?: number;
  nonceTtlMs?: number;
}

// Process-wide nonce store (replay protection). Module-scoped like the old
// siwe-verify.ts; the backend is the only verifier so a single store is fine.
const usedNonces = new Map<string, number>();

/** Test-only: clear the nonce store. */
export function _resetSiweNonceStoreForTesting(): void {
  usedNonces.clear();
}

function cleanExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}

/**
 * Verify a SIWE message and signature.
 */
export async function verifySiwe(
  message: string,
  signature: string,
  ctx: VerifySiweContext,
): Promise<VerifySiweResult> {
  const {
    verifier,
    supportedChainIds,
    expectedDomain,
    eoaAddress,
    messageMaxAgeMs = DEFAULT_MESSAGE_MAX_AGE_MS,
    nonceTtlMs = DEFAULT_NONCE_TTL_MS,
  } = ctx;

  // 1. Parse message with the standard SIWE parser
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(message);
  } catch {
    return { valid: false, address: null, error: "Invalid SIWE message format" };
  }

  const { domain, address, version, chainId, nonce, issuedAt } = parsed;

  // 2. Validate required fields
  if (!domain || !address || !version || !chainId || !nonce || !issuedAt) {
    return { valid: false, address: null, error: "Missing required SIWE fields" };
  }

  // 3. Validate Ethereum address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { valid: false, address: null, error: "Invalid Ethereum address in SIWE message" };
  }

  // 4. Domain binding
  if (expectedDomain) {
    const domainHost = domain.replace(/^https?:\/\//, "");
    const expectedHost = expectedDomain.replace(/^https?:\/\//, "");
    if (domainHost !== expectedHost) {
      return {
        valid: false,
        address: null,
        error: `Domain mismatch: expected ${expectedHost}, got ${domainHost}`,
      };
    }
  }

  // 5. Version check
  if (version !== "1") {
    return { valid: false, address: null, error: `Unsupported SIWE version: ${version}` };
  }

  // 6. Chain ID validation
  if (!supportedChainIds.includes(chainId)) {
    return { valid: false, address: null, error: `Unsupported chain ID: ${chainId}` };
  }

  // 7. Issued At freshness
  const issuedTimestamp = new Date(issuedAt).getTime();
  if (isNaN(issuedTimestamp)) {
    return { valid: false, address: null, error: "Invalid Issued At timestamp" };
  }
  const now = Date.now();
  const age = now - issuedTimestamp;
  if (age < 0) {
    return { valid: false, address: null, error: "Message timestamp is in the future" };
  }
  if (age > messageMaxAgeMs) {
    return { valid: false, address: null, error: "SIWE message is too old" };
  }

  // 8. Nonce replay protection
  cleanExpiredNonces(now);
  if (usedNonces.has(nonce)) {
    return { valid: false, address: null, error: "Nonce has already been used" };
  }

  // 9. Verify signature (EOA, EIP-1271, or ERC-6492 counterfactual smart
  //    account). The injected verifier handles all three.
  let signatureValid = false;
  try {
    signatureValid = await verifier.verifyMessage(address, message, signature, chainId);
  } catch (err) {
    const error = err as Error;
    console.error(`[SIWE] verification error for ${address}:`, error.message);
    return { valid: false, address: null, error: "Signature verification failed" };
  }

  if (!signatureValid && eoaAddress) {
    // Fallback: CDP smart accounts may restrict isValidSignature to approved
    // targets; allow the owner EOA to sign on behalf of the smart account.
    try {
      const recovered = (await verifier.recoverAddress(message, signature)).toLowerCase();
      if (recovered === eoaAddress.toLowerCase()) {
        signatureValid = true;
      }
    } catch (eoaErr) {
      const eoaError = eoaErr as Error;
      console.log(`[SIWE] EOA fallback error:`, eoaError.message);
    }
  }

  if (!signatureValid) {
    return { valid: false, address: null, error: "Signature does not match the claimed address" };
  }

  // 10. Store nonce to prevent replay
  usedNonces.set(nonce, now + nonceTtlMs);

  return { valid: true, address: address.toLowerCase(), error: null };
}
