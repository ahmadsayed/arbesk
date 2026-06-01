/**
 * Arbesk IPFS Utilities
 *
 * Shared IPFS read/write helpers with consistent timeout handling.
 * Replaces the duplicated chunk-decoding pattern in:
 *   - api/index.js (getFromIPFS)
 *   - api/assets/save-variant.js (inline)
 *   - api/assets/generate-node.js (inline, no timeout — bug!)
 */

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
