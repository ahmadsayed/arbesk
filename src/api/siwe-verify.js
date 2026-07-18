/**
 * SIWE (EIP-4361) Verification
 *
 * Uses the official `siwe` package for robust message parsing and falls back
 * to the project's configured Web3 provider for EIP-191 signature recovery.
 * This preserves the existing domain/chain/issued-at/nonce validation behavior
 * while removing the hand-rolled ABNF parser.
 */

import { SiweMessage } from "siwe";
import { verifyMessage } from "viem/actions";
import { getViemPublicClient, web3 } from "../config.js";
import { SUPPORTED_CHAIN_IDS } from "../../constants/chains.js";

// Nonce store: Map<nonce, expiresAt> - auto-cleans on verification
const usedNonces = new Map();
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MESSAGE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clean expired nonces from the store.
 */
function cleanExpiredNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) {
      usedNonces.delete(nonce);
    }
  }
}

/**
 * Parse a SIWE message into structured fields.
 * @param {string} message
 * @returns {Object|null}
 */
export function parseSiweMessage(message) {
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

/**
 * Verify a SIWE message and signature.
 *
 * @param {string} message - The SIWE message
 * @param {string} signature - The Ethereum signature
 * @param {Object} [options]
 * @param {string} [options.expectedDomain] - The expected domain (req.headers.host)
 * @param {string} [options.eoaAddress] - Owner EOA for smart-account wallets
 * @returns {Promise<{valid: boolean, address: string|null, error: string|null}>}
 */
export async function verifySiwe(
  message,
  signature,
  { expectedDomain, eoaAddress } = {},
) {
  // 1. Parse message with the standard SIWE parser
  let parsed;
  try {
    parsed = new SiweMessage(message);
  } catch {
    return {
      valid: false,
      address: null,
      error: "Invalid SIWE message format",
    };
  }

  const { domain, address, version, chainId, nonce, issuedAt } = parsed;

  // 2. Validate required fields
  if (!domain || !address || !version || !chainId || !nonce || !issuedAt) {
    return {
      valid: false,
      address: null,
      error: "Missing required SIWE fields",
    };
  }

  // 3. Validate Ethereum address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return {
      valid: false,
      address: null,
      error: "Invalid Ethereum address in SIWE message",
    };
  }

  // 4. Domain binding - accept either host-only (localhost:9090)
  // or full origin (https://localhost:9090) format. Some wallets
  // (Brave) include the protocol in the domain field.
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
    return {
      valid: false,
      address: null,
      error: `Unsupported SIWE version: ${version}`,
    };
  }

  // 6. Chain ID validation
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
    return {
      valid: false,
      address: null,
      error: `Unsupported chain ID: ${chainId}`,
    };
  }

  // 7. Issued At freshness
  const issuedTimestamp = new Date(issuedAt).getTime();
  if (isNaN(issuedTimestamp)) {
    return {
      valid: false,
      address: null,
      error: "Invalid Issued At timestamp",
    };
  }
  const age = Date.now() - issuedTimestamp;
  if (age < 0) {
    return {
      valid: false,
      address: null,
      error: "Message timestamp is in the future",
    };
  }
  if (age > MESSAGE_MAX_AGE_MS) {
    return { valid: false, address: null, error: "SIWE message is too old" };
  }

  // 8. Nonce replay protection
  cleanExpiredNonces();
  if (usedNonces.has(nonce)) {
    return {
      valid: false,
      address: null,
      error: "Nonce has already been used",
    };
  }

  // 9. Verify signature (EOA, EIP-1271, or ERC-6492 counterfactual smart account)
  // viem's verifyMessage handles all three cases in one call, including
  // CDP ERC-4337 smart accounts that have not been deployed yet.
  const viemClient = getViemPublicClient(chainId);
  if (!viemClient) {
    return {
      valid: false,
      address: null,
      error: `No RPC configured for chain ID: ${chainId}`,
    };
  }

  let signatureValid = false;
  try {
    console.log(`[SIWE] verifying signature for ${address} via viem (chainId=${chainId})`);
    signatureValid = await verifyMessage(viemClient, {
      // viem expects branded hex types; the address has already been validated.
      address: /** @type {`0x${string}`} */ (address),
      message,
      signature: /** @type {`0x${string}`} */ (signature),
    });
    console.log(`[SIWE] viem verifyMessage result for ${address}: ${signatureValid}`);
  } catch (err) {
    const error = /** @type {Error} */ (err);
    console.error(`[SIWE] viem verification error for ${address}:`, error.message);
    return {
      valid: false,
      address: null,
      error: "Signature verification failed",
    };
  }

  if (!signatureValid && eoaAddress) {
    // Fallback: CDP smart accounts (ERC-4337) may restrict
    // isValidSignature to approved targets, so ERC-6492 off-chain
    // verification fails. Allow the owner EOA to sign on behalf of the
    // smart account address claimed in the SIWE message.
    console.log(
      `[SIWE] viem verification failed for ${address}, trying EOA fallback with ${eoaAddress}`,
    );
    try {
      const recovered = (
        await web3.eth.accounts.recover(message, signature)
      ).toLowerCase();
      console.log(`[SIWE] EOA fallback recovered: ${recovered}`);
      if (recovered === eoaAddress.toLowerCase()) {
        console.log(
          `[SIWE] EOA fallback accepted for ${address} via ${eoaAddress}`,
        );
        signatureValid = true;
      }
    } catch (eoaErr) {
      const eoaError = /** @type {Error} */ (eoaErr);
      console.log(`[SIWE] EOA fallback error:`, eoaError.message);
    }
  }

  if (!signatureValid) {
    return {
      valid: false,
      address: null,
      error: "Signature does not match the claimed address",
    };
  }

  // 10. Store nonce to prevent replay
  usedNonces.set(nonce, Date.now() + NONCE_TTL_MS);

  return { valid: true, address: address.toLowerCase(), error: null };
}
