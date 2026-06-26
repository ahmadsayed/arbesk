/**
 * Arbesk IPFS Utilities
 *
 * Shared IPFS read/write helpers with consistent timeout handling.
 * Replaces the duplicated chunk-decoding pattern in:
 *   - api/index.js (getFromIPFS)
 *   - api/assets/generate-node.js (inline, no timeout — bug!)
 */

import zlib from "zlib";

/**
 * Decompress gzipped data if needed, otherwise return as-is.
 * @param {string} data - The raw data from IPFS (might be gzipped)
 * @returns {Promise<string>} Decompressed string if gzipped, original string otherwise
 */
export async function maybeDecompress(data) {
  // Check if data starts with gzip magic number (0x1f 0x8b)
  if (
    data &&
    data.length > 2 &&
    data.charCodeAt(0) === 0x1f &&
    data.charCodeAt(1) === 0x8b
  ) {
    try {
      const buffer = Buffer.from(data, "utf-8");
      const decompressed = zlib.gunzipSync(buffer);
      return decompressed.toString("utf-8");
    } catch (e) {
      console.warn("[DECOMPRESS] failed to decompress data:", e.message);
      // If decompression fails, return original data
      return data;
    }
  }
  return data;
}

/**
 * Read and decode a manifest from IPFS with a configurable timeout.
 *
 * Handles all chunk encoding variants:
 *   - Uint16Array (mock/test)
 *   - Uint8Array / Buffer (real Kubo IPFS node)
 *   - String
 *
 * @param {Object} ipfs - ipfs-http-client instance
 * @param {string} cid - IPFS CID to read
 * @param {number} [timeoutMs=15000] - AbortController timeout in ms
 * @returns {Promise<string>} Decoded manifest text
 * @throws {Error} If the CID is not found or the operation times out
 */
export async function catManifest(ipfs, cid, timeoutMs = 15000) {
  console.log(`[IPFS] cat ${cid}`);
  const catController = new AbortController();
  const catTimeoutId = setTimeout(() => catController.abort(), timeoutMs);

  try {
    const chunks = [];
    for await (const chunk of ipfs.cat(cid, { signal: catController.signal })) {
      chunks.push(chunk);
    }

    const data = chunks
      .map((chunk) => {
        if (chunk instanceof Uint16Array) {
          return String.fromCharCode(...chunk);
        }
        if (typeof chunk === "string") return chunk;
        return new TextDecoder().decode(chunk);
      })
      .join("");

    console.log(`[IPFS] cat ${cid} → ${data.length} chars`);
    return data;
  } finally {
    clearTimeout(catTimeoutId);
  }
}

const IPFS_URI_RE = /ipfs:\/\/([a-zA-Z0-9]+)/g;

/**
 * Recursively extract all ipfs:// CIDs from a JSON value.
 * @param {*} value - A string, array, or object to scan
 * @param {Set<string>} cids - Set to collect CIDs into
 */
export function extractIpfsCids(value, cids) {
  if (typeof value === "string") {
    for (const match of value.matchAll(IPFS_URI_RE)) {
      cids.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) extractIpfsCids(item, cids);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) extractIpfsCids(v, cids);
  }
}
