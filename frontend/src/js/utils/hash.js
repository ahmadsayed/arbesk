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

export const DEFAULT_HASH_ALGORITHM = "murmur3-128";

/**
 * Algorithms accepted as content-identity keys (dedup + content cache). Both
 * are non-cryptographic MurmurHash3 variants and produce a stable, backend /
 * chunker-independent identity computed client-side over the raw bytes.
 * `murmur3-32` is retained so composites written before the 128-bit migration
 * still resolve from the dedup map and the content cache.
 */
export const SUPPORTED_HASH_ALGORITHMS = new Set(["murmur3-32", "murmur3-128"]);

/**
 * Convert a 32-bit unsigned integer to an 8-digit hex string.
 */
function u32ToHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function rotl32(x, r) {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
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
 * MurmurHash3 x86 128-bit for Uint8Array bytes.
 *
 * The x86_128 variant is used (not x64_128) because it relies solely on 32-bit
 * arithmetic via Math.imul, which is fast and exact in JS without BigInt. The
 * result is a 32-character hex string (four 32-bit lanes). Determinism is
 * guaranteed across the main thread and Web Workers since both import this same
 * function.
 *
 * Based on the public-domain reference implementation by Austin Appleby.
 *
 * @param {Uint8Array} bytes
 * @param {number} [seed=0]
 * @returns {string} 32-character hex-encoded 128-bit hash
 */
export function murmur3_128(bytes, seed = 0) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("murmur3_128: expected Uint8Array");
  }

  const len = bytes.length;
  const nblocks = len >> 4; // 16-byte (4 x uint32) blocks

  let h1 = seed >>> 0;
  let h2 = seed >>> 0;
  let h3 = seed >>> 0;
  let h4 = seed >>> 0;

  const c1 = 0x239b961b;
  const c2 = 0xab0e9789;
  const c3 = 0x38b34ae5;
  const c4 = 0xa1e38b93;

  // Body
  let i = 0;
  for (let b = 0; b < nblocks; b++) {
    let k1 =
      (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    let k2 =
      (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
    let k3 =
      (bytes[i + 8] | (bytes[i + 9] << 8) | (bytes[i + 10] << 16) | (bytes[i + 11] << 24)) >>> 0;
    let k4 =
      (bytes[i + 12] | (bytes[i + 13] << 8) | (bytes[i + 14] << 16) | (bytes[i + 15] << 24)) >>> 0;
    i += 16;

    k1 = Math.imul(k1, c1); k1 = rotl32(k1, 15); k1 = Math.imul(k1, c2); h1 ^= k1;
    h1 = rotl32(h1, 19); h1 = (h1 + h2) >>> 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) >>> 0;

    k2 = Math.imul(k2, c2); k2 = rotl32(k2, 16); k2 = Math.imul(k2, c3); h2 ^= k2;
    h2 = rotl32(h2, 17); h2 = (h2 + h3) >>> 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) >>> 0;

    k3 = Math.imul(k3, c3); k3 = rotl32(k3, 17); k3 = Math.imul(k3, c4); h3 ^= k3;
    h3 = rotl32(h3, 15); h3 = (h3 + h4) >>> 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) >>> 0;

    k4 = Math.imul(k4, c4); k4 = rotl32(k4, 18); k4 = Math.imul(k4, c1); h4 ^= k4;
    h4 = rotl32(h4, 13); h4 = (h4 + h1) >>> 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) >>> 0;
  }

  // Tail
  let k1 = 0;
  let k2 = 0;
  let k3 = 0;
  let k4 = 0;
  const tail = nblocks << 4;
  switch (len & 15) {
    case 15: k4 ^= bytes[tail + 14] << 16; // fallthrough
    case 14: k4 ^= bytes[tail + 13] << 8; // fallthrough
    case 13:
      k4 ^= bytes[tail + 12];
      k4 = Math.imul(k4, c4); k4 = rotl32(k4, 18); k4 = Math.imul(k4, c1); h4 ^= k4;
    // fallthrough
    case 12: k3 ^= bytes[tail + 11] << 24; // fallthrough
    case 11: k3 ^= bytes[tail + 10] << 16; // fallthrough
    case 10: k3 ^= bytes[tail + 9] << 8; // fallthrough
    case 9:
      k3 ^= bytes[tail + 8];
      k3 = Math.imul(k3, c3); k3 = rotl32(k3, 17); k3 = Math.imul(k3, c4); h3 ^= k3;
    // fallthrough
    case 8: k2 ^= bytes[tail + 7] << 24; // fallthrough
    case 7: k2 ^= bytes[tail + 6] << 16; // fallthrough
    case 6: k2 ^= bytes[tail + 5] << 8; // fallthrough
    case 5:
      k2 ^= bytes[tail + 4];
      k2 = Math.imul(k2, c2); k2 = rotl32(k2, 16); k2 = Math.imul(k2, c3); h2 ^= k2;
    // fallthrough
    case 4: k1 ^= bytes[tail + 3] << 24; // fallthrough
    case 3: k1 ^= bytes[tail + 2] << 16; // fallthrough
    case 2: k1 ^= bytes[tail + 1] << 8; // fallthrough
    case 1:
      k1 ^= bytes[tail];
      k1 = Math.imul(k1, c1); k1 = rotl32(k1, 15); k1 = Math.imul(k1, c2); h1 ^= k1;
  }

  // Finalization
  h1 = (h1 ^ len) >>> 0; h2 = (h2 ^ len) >>> 0; h3 = (h3 ^ len) >>> 0; h4 = (h4 ^ len) >>> 0;
  h1 = (h1 + h2) >>> 0; h1 = (h1 + h3) >>> 0; h1 = (h1 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0;

  h1 = fmix32(h1); h2 = fmix32(h2); h3 = fmix32(h3); h4 = fmix32(h4);

  h1 = (h1 + h2) >>> 0; h1 = (h1 + h3) >>> 0; h1 = (h1 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0;

  return u32ToHex(h1) + u32ToHex(h2) + u32ToHex(h3) + u32ToHex(h4);
}

/**
 * Hash bytes using the chosen algorithm and return a hex string.
 *
 * @param {Uint8Array} bytes
 * @param {string} [algorithm="murmur3-128"]
 * @returns {string} hex-encoded hash
 */
export function hashBytes(bytes, algorithm = DEFAULT_HASH_ALGORITHM) {
  if (algorithm === "murmur3-128") {
    return murmur3_128(bytes);
  }
  if (algorithm === "murmur3-32") {
    return u32ToHex(murmur3_32(bytes));
  }
  throw new Error(`hashBytes: unsupported algorithm "${algorithm}"`);
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
