/**
 * Pure functions for normalizing IPFS URIs and extracting CIDs.
 * @remarks Zero external dependencies, so safe to import from Node.js test
 *   runners.
 */

/**
 * Normalizes a tokenURI response to a plain CID string.
 */
export function normalizeTokenURI(uri: string): string {
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
