/**
 * Cache-aware CID → base64 fetch helper.
 *
 * Shared between the main-thread composer and the glTF Web Worker so both
 * can use the MurmurHash3-based IndexedDB cache for large buffers/images.
 *
 * The caller supplies two fetch functions:
 *   - fetchRaw(cid) returns the exact stored bytes (possibly gzipped).
 *   - fetchDecompressed(cid) returns the uncompressed payload.
 *
 * When `_arbesk` metadata is present and the stored payload is large enough,
 * the helper checks the content cache by hash before fetching. Cache misses
 * are fetched raw and stored for the next load.
 */

import { arrayBufferToBase64 } from "../utils/encoding.js";
import { SUPPORTED_HASH_ALGORITHMS } from "../utils/hash.js";
import {
  getPayload,
  putPayload,
  BIG_CONTENT_THRESHOLD_BYTES,
} from "../utils/content-cache.js";

/**
 * @param {ArrayBufferLike} buffer
 * @returns {Uint8Array}
 */
function bytesFromBuffer(buffer) {
  // The fetchRaw contract returns whole buffers, so byteOffset is always
  // absent (0) and byteLength covers the full buffer.
  const view = /** @type {any} */ (buffer);
  return new Uint8Array(buffer, view.byteOffset, view.byteLength);
}

/**
 * Fetch a CID as a base64 string, using the content cache when possible.
 *
 * @param {string} cid
 * @param {any} arbeskMeta - `_arbesk` metadata from a composite glTF entry (dynamic shape)
 * @param {object} fetchers
 * @param {function(string): Promise<ArrayBufferLike>} fetchers.fetchRaw - returns stored bytes (may be gzipped)
 * @param {function(string): Promise<ArrayBuffer>} fetchers.fetchDecompressed - returns uncompressed bytes
 * @param {function(Uint8Array): Uint8Array|Promise<Uint8Array>} fetchers.decompress - decompresses gzipped bytes
 * @returns {Promise<string>} base64-encoded payload
 */
export async function fetchCIDAsBase64(cid, arbeskMeta, { fetchRaw, fetchDecompressed, decompress }) {
  const useCache =
    arbeskMeta &&
    SUPPORTED_HASH_ALGORITHMS.has(arbeskMeta.hashAlgo) &&
    (arbeskMeta.bytes || 0) >= BIG_CONTENT_THRESHOLD_BYTES;

  if (useCache) {
    const cached = await getPayload(arbeskMeta.hash);
    if (cached) {
      const bytes = cached.compressed
        ? await decompress(cached.bytes)
        : cached.bytes;
      return arrayBufferToBase64(/** @type {ArrayBuffer} */ (bytes.buffer));
    }

    const rawBuffer = await fetchRaw(cid);
    const rawBytes = bytesFromBuffer(rawBuffer);
    putPayload(arbeskMeta.hash, cid, !!arbeskMeta.compressed, rawBytes).catch(
      (err) => console.warn(`[CACHE-FETCH] cache write failed: ${err.message}`)
    );
    const bytes = arbeskMeta.compressed ? await decompress(rawBytes) : rawBytes;
    return arrayBufferToBase64(/** @type {ArrayBuffer} */ (bytes.buffer));
  }

  const buffer = await fetchDecompressed(cid);
  return arrayBufferToBase64(buffer);
}
