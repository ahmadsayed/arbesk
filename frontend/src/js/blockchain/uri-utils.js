/**
 * Arbesk URI Utilities
 *
 * Pure functions for normalizing IPFS URIs and extracting CIDs.
 * Zero external dependencies — safe to import from Node.js test runners.
 */

/**
 * Normalize a tokenURI response to a plain CID string.
 * Handles:
 *   - Plain CID: "bafkreiABC123..."
 *   - ipfs:// URI: "ipfs://bafkreiABC123..."
 *   - ipfs:// with path: "ipfs://bafkreiABC123/path/to/manifest.json"
 *   - HTTP gateway URL: "http://127.0.0.1:8080/ipfs/bafkreiABC123..."
 *   - Full URL: "https://ipfs.io/ipfs/bafkreiABC123..."
 *
 * @param {string} uri
 * @returns {string} Plain CID
 */
export function normalizeTokenURI(uri) {
  if (!uri || typeof uri !== "string") return "";

  let normalized = uri.trim();

  // Remove ipfs:// or ipfs/ prefix
  if (normalized.startsWith("ipfs://")) {
    normalized = normalized.slice(7);
  }

  // Remove HTTP gateway prefix
  const ipfsPathMatch = normalized.match(/\/ipfs\/([A-Za-z0-9]{46,})/);
  if (ipfsPathMatch) {
    normalized = ipfsPathMatch[1];
  }

  // Remove any trailing path or query
  const cidMatch = normalized.match(/^([A-Za-z0-9]{46,})/);
  if (cidMatch) {
    normalized = cidMatch[1];
  }

  return normalized;
}
