/** @jest-environment node */
import {
  hashBytes,
  murmur3_128,
  DEFAULT_HASH_ALGORITHM,
  SUPPORTED_HASH_ALGORITHMS,
} from "../../frontend/src/js/utils/hash.js";

/**
 * murmur3-128 is the wider, still non-cryptographic content-hash used as the
 * dedup + content-cache key. A 128-bit digest makes collisions negligible
 * (vs ~1% lifetime risk at 32 bits for a large library) while staying fast and
 * backend/chunker-independent, so it preserves cross-CID content sharing
 * without needing a CID guard.
 */
describe("murmur3-128 content hash", () => {
  it("is the default algorithm", () => {
    expect(DEFAULT_HASH_ALGORITHM).toBe("murmur3-128");
  });

  it("hashBytes() defaults to a 128-bit (32 hex char) digest", () => {
    const h = hashBytes(new Uint8Array([1, 2, 3, 4]));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic for identical input", () => {
    const bytes = new Uint8Array(
      Array.from({ length: 100 }, (_, i) => i & 0xff)
    );
    expect(hashBytes(bytes)).toBe(hashBytes(bytes));
    expect(murmur3_128(bytes)).toBe(murmur3_128(bytes));
  });

  it("returns all zeros for empty input at seed 0", () => {
    expect(murmur3_128(new Uint8Array([]))).toBe("0".repeat(32));
  });

  it("avalanches: a single-bit input change flips many output nibbles", () => {
    const a = new Uint8Array(64).fill(0);
    const b = new Uint8Array(64).fill(0);
    b[0] = 1; // single-bit difference
    const ha = murmur3_128(a);
    const hb = murmur3_128(b);
    expect(ha).not.toBe(hb);
    let diff = 0;
    for (let i = 0; i < ha.length; i++) if (ha[i] !== hb[i]) diff++;
    expect(diff).toBeGreaterThan(8); // >1/4 of 32 nibbles change
  });

  it("distinguishes inputs that differ only in length", () => {
    expect(murmur3_128(new Uint8Array([1, 2, 3]))).not.toBe(
      murmur3_128(new Uint8Array([1, 2, 3, 0]))
    );
  });

  it("still supports murmur3-32 for backward compatibility (8 hex chars)", () => {
    const h = hashBytes(new Uint8Array([1, 2, 3, 4]), "murmur3-32");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it("lists both murmur algorithms as supported", () => {
    expect(SUPPORTED_HASH_ALGORITHMS.has("murmur3-32")).toBe(true);
    expect(SUPPORTED_HASH_ALGORITHMS.has("murmur3-128")).toBe(true);
    expect(SUPPORTED_HASH_ALGORITHMS.has("sha-1")).toBe(false);
  });

  it("rejects unsupported algorithms", () => {
    expect(() => hashBytes(new Uint8Array([1]), "sha-1")).toThrow();
  });
});
