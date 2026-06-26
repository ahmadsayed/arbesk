/**
 * Arbesk IPFS Utilities
 *
 * Shared IPFS read/write helpers with consistent timeout handling.
 * Replaces the duplicated chunk-decoding pattern in:
 *   - api/index.js (getFromIPFS)
 *   - api/assets/generate-node.js (inline, no timeout - bug!)
 */

import zlib from "zlib";

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data, "utf-8");
  return Buffer.from(data);
}

/**
 * Decompress gzipped data if needed, otherwise return as-is.
 * @param {Buffer|Uint8Array|ArrayBuffer|string} data - The raw data from IPFS (might be gzipped)
 * @returns {Promise<string>} Decompressed string if gzipped, original string otherwise
 */
export async function maybeDecompress(data) {
  if (!data) return data;

  // Legacy string path: only reliable for uncompressed strings. Gzipped binary
  // that has already been UTF-8 decoded to a string cannot be decompressed
  // because the byte sequence has been replaced/re-encoded. Callers that need
  // to handle gzipped content should pass raw bytes from catBytes().
  if (typeof data === "string") {
    if (
      data.length >= 2 &&
      data.charCodeAt(0) === 0x1f &&
      data.charCodeAt(1) === 0x8b
    ) {
      try {
        const decompressed = zlib.gunzipSync(Buffer.from(data, "utf-8"));
        return decompressed.toString("utf-8");
      } catch (e) {
        console.warn("[DECOMPRESS] failed to decompress string data:", e.message);
      }
    }
    return data;
  }

  const buffer = toBuffer(data);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      const decompressed = zlib.gunzipSync(buffer);
      return decompressed.toString("utf-8");
    } catch (e) {
      console.warn("[DECOMPRESS] failed to decompress buffer:", e.message);
    }
  }
  return buffer.toString("utf-8");
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

/**
 * Read raw bytes from IPFS with a configurable timeout.
 * Returns a Buffer so gzip-compressed or binary content can be handled
 * before any text decoding corrupts it.
 *
 * @param {Object} ipfs - ipfs-http-client instance
 * @param {string} cid - IPFS CID to read
 * @param {number} [timeoutMs=15000] - AbortController timeout in ms
 * @returns {Promise<Buffer>} Raw bytes
 * @throws {Error} If the CID is not found or the operation times out
 */
export async function catBytes(ipfs, cid, timeoutMs = 15000) {
  console.log(`[IPFS] catBytes ${cid}`);
  const catController = new AbortController();
  const catTimeoutId = setTimeout(() => catController.abort(), timeoutMs);

  try {
    const chunks = [];
    for await (const chunk of ipfs.cat(cid, { signal: catController.signal })) {
      if (chunk instanceof Uint16Array) {
        // Test-mock path: char codes that encode a UTF-8 string.
        chunks.push(Buffer.from(String.fromCharCode(...chunk), "utf-8"));
      } else {
        chunks.push(toBuffer(chunk));
      }
    }
    const buffer = Buffer.concat(chunks);
    console.log(`[IPFS] catBytes ${cid} → ${buffer.length} bytes`);
    return buffer;
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
