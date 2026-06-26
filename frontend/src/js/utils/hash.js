// @ts-nocheck
/**
 * Fast, non-cryptographic hash helpers for binary deduplication.
 *
 * The default is MurmurHash3 32-bit (x86) over Uint8Array bytes. It is fast,
 * has good distribution, and is sufficient for detecting identical upload
 * payloads within a single asset lineage.
 *
 * A SHA-256 helper is also provided for callers that need collision
 * resistance; it is async because it uses the Web Crypto API.
 */

const DEFAULT_ALGORITHM = "murmur3-32";

/**
 * Convert a 32-bit unsigned integer to an 8-digit hex string.
 */
function u32ToHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * MurmurHash3 32-bit (x86) for Uint8Array bytes.
 *
 * Based on the public-domain reference implementation by Austin Appleby.
 *
 * @param {Uint8Array} bytes
 * @param {number} [seed=0]
 * @returns {number} 32-bit unsigned hash value
 */
export function murmur3_32(bytes, seed = 0) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("murmur3_32: expected Uint8Array");
  }

  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const r1 = 15;
  const r2 = 13;
  const m = 5;
  const n = 0xe6546b64;

  let h1 = seed >>> 0;
  let i = 0;
  const len = bytes.length;

  // Process 4-byte chunks
  const remainder = len & ~3;
  for (; i < remainder; i += 4) {
    let k1 =
      (bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24)) >>>
      0;

    k1 = Math.imul(k1, c1);
    k1 = ((k1 << r1) | (k1 >>> (32 - r1))) >>> 0;
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = ((h1 << r2) | (h1 >>> (32 - r2))) >>> 0;
    h1 = (Math.imul(h1, m) + n) >>> 0;
  }

  // Tail
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= bytes[i + 2] << 16;
    // fallthrough
    case 2:
      k1 ^= bytes[i + 1] << 8;
    // fallthrough
    case 1:
      k1 ^= bytes[i];
      k1 = Math.imul(k1, c1);
      k1 = ((k1 << r1) | (k1 >>> (32 - r1))) >>> 0;
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= len >>> 0;

  // Finalization mix
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Hash bytes using the chosen algorithm and return a hex string.
 *
 * @param {Uint8Array} bytes
 * @param {string} [algorithm="murmur3-32"]
 * @returns {string} hex-encoded hash
 */
export function hashBytes(bytes, algorithm = DEFAULT_ALGORITHM) {
  if (algorithm !== DEFAULT_ALGORITHM) {
    throw new Error(`hashBytes: unsupported algorithm "${algorithm}"`);
  }
  return u32ToHex(murmur3_32(bytes));
}

/**
 * Async SHA-256 helper using Web Crypto API.
 * Returns a hex string. Use this when collision resistance matters more
 * than raw speed.
 *
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Promise<string>}
 */
export async function sha256Hex(data) {
  const buffer = data instanceof Uint8Array ? data.buffer : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
