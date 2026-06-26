// @ts-nocheck
/**
 * Sign-In with Ethereum (EIP-4361) Message Builder
 *
 * Builds standard SIWE messages for wallet authentication.
 * No external dependencies - pure string formatting.
 *
 * Usage:
 *   import { buildSiweMessage, generateNonce } from './siwe.js';
 *   const message = buildSiweMessage(domain, address, nonce, chainId);
 */

/**
 * Generate a random nonce for SIWE.
 * @returns {string} 16-character alphanumeric nonce
 */
export function generateNonce() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a standard EIP-4361 SIWE message.
 *
 * @param {string} domain - The domain requesting the signature (e.g., "localhost:9090")
 * @param {string} address - The Ethereum address (0x-prefixed)
 * @param {string} nonce - A random nonce for replay protection
 * @param {number} chainId - The Ethereum chain ID
 * @param {string} [statement="Sign in to Arbesk Studio"] - Human-readable statement
 * @returns {string} The SIWE message
 */
export function buildSiweMessage(
  domain,
  address,
  nonce,
  chainId,
  statement = "Sign in to Arbesk Studio"
) {
  const issuedAt = new Date().toISOString();
  const uri = typeof window !== "undefined" ? window.location.host : "";

  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

/**
 * Parse a SIWE message to extract its fields.
 * @param {string} message
 * @returns {Object|null} { domain, address, statement, uri, version, chainId, nonce, issuedAt }
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

    // Find statement (line after blank line, before URI)
    let statement = null;
    let uri = null;
    let version = null;
    let chainId = null;
    let nonce = null;
    let issuedAt = null;

    for (const line of lines) {
      if (line.startsWith("URI: ")) uri = line.slice(5);
      if (line.startsWith("Version: ")) version = line.slice(9);
      if (line.startsWith("Chain ID: ")) chainId = parseInt(line.slice(10), 10);
      if (line.startsWith("Nonce: ")) nonce = line.slice(7);
      if (line.startsWith("Issued At: ")) issuedAt = line.slice(11);
    }

    // Statement is the line between the blank line and URI
    const blankLineIdx = lines.indexOf("");
    if (blankLineIdx >= 0 && lines[blankLineIdx + 1] && !lines[blankLineIdx + 1].includes(":")) {
      statement = lines[blankLineIdx + 1];
    }

    return { domain, address, statement, uri, version, chainId, nonce, issuedAt };
  } catch {
    return null;
  }
}
