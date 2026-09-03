/**
 * Cache-aware CID → base64 fetch helper.
 * @remarks Shared by the main-thread composer and the glTF Web Worker so both
 *   use the MurmurHash3-based IndexedDB cache for large buffers/images. When
 *   `_arbesk` metadata marks a payload large enough, it checks the content
 *   cache by hash before fetching; misses are fetched raw and stored.
 */

import { arrayBufferToBase64 } from "../../utils/encoding.ts";
import { SUPPORTED_HASH_ALGORITHMS } from "../../utils/hash.ts";
import {
  getPayload,
  putPayload,
  BIG_CONTENT_THRESHOLD_BYTES,
} from "../../utils/content-cache.ts";

interface CidFetchers {
  /** returns stored bytes (may be gzipped) */
  fetchRaw: (cid: string) => Promise<ArrayBufferLike>;
  /** returns uncompressed bytes */
  fetchDecompressed: (cid: string) => Promise<ArrayBuffer>;
  /** decompresses gzipped bytes */
  decompress: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
  /** base64 encoder (defaults to the pure util; main thread injects the kernel) */
  base64Encode?: (bytes: Uint8Array | ArrayBuffer) => string;
}

function bytesFromBuffer(buffer: ArrayBufferLike): Uint8Array {
  // The fetchRaw contract returns whole buffers, so byteOffset is always
  // absent (0) and byteLength covers the full buffer.
  const view = buffer as any;
  return new Uint8Array(buffer, view.byteOffset, view.byteLength);
}

/**
 * Fetches a CID as a base64 string, using the content cache when possible.
 * @param arbeskMeta - `_arbesk` metadata from a composite glTF entry (dynamic shape)
 */
export async function fetchCIDAsBase64(
  cid: string,
  arbeskMeta: any,
  { fetchRaw, fetchDecompressed, decompress, base64Encode = arrayBufferToBase64 }: CidFetchers
): Promise<string> {
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
      return base64Encode(bytes.buffer as ArrayBuffer);
    }

    const rawBuffer = await fetchRaw(cid);
    const rawBytes = bytesFromBuffer(rawBuffer);
    putPayload(arbeskMeta.hash, cid, !!arbeskMeta.compressed, rawBytes).catch(
      (err) => console.warn(`[CACHE-FETCH] cache write failed: ${err.message}`)
    );
    const bytes = arbeskMeta.compressed ? await decompress(rawBytes) : rawBytes;
    return base64Encode(bytes.buffer as ArrayBuffer);
  }

  const buffer = await fetchDecompressed(cid);
  return base64Encode(buffer);
}
