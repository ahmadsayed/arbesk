/**
 * Arbesk glTF deduplication helpers - unit tests.
 *
 * Tests the pure hash→CID logic in frontend/src/js/gltf/dedup.js with a
 * mocked writeToIPFS so no network/IPFS node is required.
 */

import { jest } from "@jest/globals";

// Provide browser globals used by the modules under test.
globalThis.crypto = {
  subtle: {
    digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
  },
};

// Mock the IPFS writer before importing dedup.js.
jest.unstable_mockModule("../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
  writeToIPFS: jest.fn(),
}));

const { hashBytes } = await import("../frontend/src/js/utils/hash.js");
const { writeToIPFS } = await import(
  "../frontend/src/js/ipfs/write-to-ipfs.js"
);
const {
  buildDedupMap,
  uploadWithDedup,
  attachDedupMeta,
  stripDedupMeta,
  cidFromIpfsUri,
  ipfsUriFromCid,
} = await import("../frontend/src/js/gltf/dedup.js");

describe("dedup helpers", () => {
  beforeEach(() => {
    writeToIPFS.mockReset();
  });

  describe("ipfsUriFromCid / cidFromIpfsUri", () => {
    it("converts a CID to an ipfs:// URI", () => {
      expect(ipfsUriFromCid("bafyTest")).toBe("ipfs://bafyTest");
    });

    it("extracts a CID from an ipfs:// URI", () => {
      expect(cidFromIpfsUri("ipfs://bafyTest")).toBe("bafyTest");
    });

    it("returns null for non-ipfs URIs", () => {
      expect(cidFromIpfsUri("data:base64,abc")).toBeNull();
      expect(cidFromIpfsUri(null)).toBeNull();
    });
  });

  describe("buildDedupMap", () => {
    it("builds a hash→CID map from composite buffers and images", () => {
      const hash1 = hashBytes(new Uint8Array([1, 2, 3]));
      const hash2 = hashBytes(new Uint8Array([4, 5, 6]));
      const composite = {
        buffers: [
          { uri: "ipfs://bafyBuf", _arbesk: { hash: hash1, hashAlgo: "murmur3-32" } },
        ],
        images: [
          { uri: "ipfs://bafyImg", _arbesk: { hash: hash2, hashAlgo: "murmur3-32" } },
        ],
      };
      const map = buildDedupMap(composite);
      expect(map.get(hash1)).toBe("bafyBuf");
      expect(map.get(hash2)).toBe("bafyImg");
    });

    it("ignores entries with unknown hash algorithms", () => {
      const composite = {
        buffers: [
          {
            uri: "ipfs://bafyBuf",
            _arbesk: { hash: "abc", hashAlgo: "sha-1" },
          },
        ],
      };
      const map = buildDedupMap(composite);
      expect(map.size).toBe(0);
    });

    it("ignores non-ipfs URIs", () => {
      const hash = hashBytes(new Uint8Array([1]));
      const composite = {
        buffers: [
          {
            uri: "data:application/octet-stream;base64,AQ==",
            _arbesk: { hash, hashAlgo: "murmur3-32" },
          },
        ],
      };
      const map = buildDedupMap(composite);
      expect(map.size).toBe(0);
    });

    it("merges multiple composites", () => {
      const h1 = hashBytes(new Uint8Array([1]));
      const h2 = hashBytes(new Uint8Array([2]));
      const a = { buffers: [{ uri: "ipfs://bafyA", _arbesk: { hash: h1, hashAlgo: "murmur3-32" } }] };
      const b = { images: [{ uri: "ipfs://bafyB", _arbesk: { hash: h2, hashAlgo: "murmur3-32" } }] };
      const map = buildDedupMap([a, b]);
      expect(map.get(h1)).toBe("bafyA");
      expect(map.get(h2)).toBe("bafyB");
    });
  });

  describe("uploadWithDedup", () => {
    it("uploads new bytes when no dedup map is provided", async () => {
      writeToIPFS.mockResolvedValue("bafyNew");
      const bytes = new Uint8Array([1, 2, 3]);
      const { cid, meta, skipped } = await uploadWithDedup(
        bytes,
        "buffer.bin",
        null,
        { compress: false }
      );
      expect(cid).toBe("bafyNew");
      expect(skipped).toBe(false);
      expect(meta.hash).toBe(hashBytes(bytes));
      expect(meta.hashAlgo).toBe("murmur3-128");
      expect(meta.compressed).toBe(false);
      expect(writeToIPFS).toHaveBeenCalledTimes(1);
    });

    it("skips upload when hash matches the dedup map", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const hash = hashBytes(bytes);
      const map = new Map([[hash, "bafyReused"]]);
      const { cid, meta, skipped } = await uploadWithDedup(
        bytes,
        "buffer.bin",
        null,
        { compress: false },
        map
      );
      expect(cid).toBe("bafyReused");
      expect(skipped).toBe(true);
      expect(meta.hash).toBe(hash);
      expect(writeToIPFS).not.toHaveBeenCalled();
    });

    it("uploads when hash is not in the dedup map", async () => {
      writeToIPFS.mockResolvedValue("bafyUploaded");
      const bytes = new Uint8Array([1, 2, 3]);
      const map = new Map([["00000000", "bafyReused"]]);
      const { cid, skipped } = await uploadWithDedup(
        bytes,
        "buffer.bin",
        null,
        { compress: false },
        map
      );
      expect(cid).toBe("bafyUploaded");
      expect(skipped).toBe(false);
      expect(writeToIPFS).toHaveBeenCalledTimes(1);
    });

    it("compresses bytes before hashing and uploading", async () => {
      writeToIPFS.mockResolvedValue("bafyCompressed");
      const bytes = new TextEncoder().encode("hello world");
      const { meta } = await uploadWithDedup(bytes, "buffer.bin", null, {
        compress: true,
      });
      expect(meta.compressed).toBe(true);
      expect(writeToIPFS).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "buffer.bin.gz",
        null,
        { compress: false }
      );
    });
  });

  describe("attachDedupMeta / stripDedupMeta", () => {
    it("attaches _arbesk metadata to a buffer entry", () => {
      const item = { uri: "ipfs://bafyTest", byteLength: 5 };
      const meta = { hash: "abc", hashAlgo: "murmur3-32", compressed: false, bytes: 5 };
      const attached = attachDedupMeta(item, meta);
      expect(attached._arbesk).toEqual(meta);
      expect(attached.uri).toBe("ipfs://bafyTest");
    });

    it("strips _arbesk metadata from all buffers and images", () => {
      const composite = {
        asset: { version: "2.0" },
        buffers: [{ uri: "ipfs://bafyBuf", _arbesk: { hash: "abc" } }],
        images: [{ uri: "ipfs://bafyImg", _arbesk: { hash: "def" } }],
        materials: [{ name: "Mat" }],
      };
      const cleaned = stripDedupMeta(composite);
      expect(cleaned.buffers[0]._arbesk).toBeUndefined();
      expect(cleaned.images[0]._arbesk).toBeUndefined();
      expect(cleaned.materials[0].name).toBe("Mat");
    });

    it("does not mutate the original composite", () => {
      const composite = {
        buffers: [{ uri: "ipfs://bafyBuf", _arbesk: { hash: "abc" } }],
      };
      const cleaned = stripDedupMeta(composite);
      expect(composite.buffers[0]._arbesk).toBeDefined();
      expect(cleaned.buffers[0]._arbesk).toBeUndefined();
    });
  });
});
