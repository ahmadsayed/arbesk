/**
 * SIWE (EIP-4361) Verification
 *
 * Verifies Sign-In with Ethereum messages without external dependencies.
 * Parses the standard SIWE format and validates all security constraints.
 */

import { web3 } from "../config.js";
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
    const lines = message.split("\n");

    // First line: "{domain} wants you to sign in with your Ethereum account:"
    const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in/);
    const domain = domainMatch ? domainMatch[1] : null;

    // Second line: address
    const address = lines[1]?.trim() || null;

    // Extract key-value pairs
    let uri = null;
    let version = null;
    let chainId = null;
    let nonce = null;
    let issuedAt = null;
    let statement = null;

    for (const line of lines) {
      if (line.startsWith("URI: ")) uri = line.slice(5);
      if (line.startsWith("Version: ")) version = line.slice(9);
      if (line.startsWith("Chain ID: ")) chainId = parseInt(line.slice(10), 10);
      if (line.startsWith("Nonce: ")) nonce = line.slice(7);
      if (line.startsWith("Issued At: ")) issuedAt = line.slice(11);
    }

    // Statement is the line between the first blank line and the URI line
    const blankLineIdx = lines.indexOf("");
    if (blankLineIdx >= 0) {
      const afterBlank = lines.slice(blankLineIdx + 1);
      const firstKvIdx = afterBlank.findIndex((l) => l.includes(":"));
      if (firstKvIdx > 0) {
        statement = afterBlank.slice(0, firstKvIdx).join("\n").trim();
      } else if (afterBlank.length > 0 && !afterBlank[0].includes(":")) {
        statement = afterBlank[0];
      }
    }

    return {
      domain,
      address,
      statement,
      uri,
      version,
      chainId,
      nonce,
      issuedAt,
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
 * @returns {Promise<{valid: boolean, address: string|null, error: string|null}>}
 */
export async function verifySiwe(message, signature, { expectedDomain } = {}) {
  // 1. Parse message
  const parsed = parseSiweMessage(message);
  if (!parsed) {
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

  // 9. Recover address from signature
  let recoveredAddress;
  try {
    recoveredAddress = (
      await web3.eth.accounts.recover(message, signature)
    ).toLowerCase();
  } catch (e) {
    return {
      valid: false,
      address: null,
      error: "Failed to recover address from signature",
    };
  }

  if (recoveredAddress !== address.toLowerCase()) {
    return {
      valid: false,
      address: null,
      error: "Signature does not match the claimed address",
    };
  }

  // 10. Store nonce to prevent replay
  usedNonces.set(nonce, Date.now() + NONCE_TTL_MS);

  return { valid: true, address: recoveredAddress, error: null };
}
