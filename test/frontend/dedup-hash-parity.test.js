/** @jest-environment jsdom */
import { jest } from "@jest/globals";

/**
 * Finding A regression: the worker path (native CompressionStream) and the
 * main-thread path (pako) emit different gzip bytes for the same input. If the
 * dedup / content-cache key were computed over the *compressed* bytes, the two
 * paths would never share a dedup map and the content cache would double-store
 * identical content. Both paths must therefore key on the RAW content hash.
 */
describe("uploadWithDedup - raw-content hash parity (Finding A)", () => {
  async function loadModule() {
    jest.resetModules();
    const writeToIPFS = jest.fn().mockResolvedValue("bafyCid");
    jest.unstable_mockModule(
      "../../frontend/src/js/ipfs/write-to-ipfs.js",
      () => ({ __esModule: true, writeToIPFS })
    );
    const mod = await import("../../frontend/src/js/gltf/dedup.js");
    const hashMod = await import("../../frontend/src/js/utils/hash.js");
    return { mod, hashMod, writeToIPFS };
  }

  it("hashes over RAW bytes regardless of compression (matches the worker hash basis)", async () => {
    const { mod, hashMod } = await loadModule();
    const bytes = new Uint8Array(
      Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff)
    );
    const rawHash = hashMod.hashBytes(bytes);

    const compressed = await mod.uploadWithDedup(bytes, "a.bin", null, {
      compress: true,
    });
    const raw = await mod.uploadWithDedup(bytes, "b.bin", null, {
      compress: false,
    });

    expect(compressed.meta.hash).toBe(rawHash);
    expect(raw.meta.hash).toBe(rawHash);
    expect(compressed.meta.hash).toBe(raw.meta.hash);
  });

  it("records the raw byte length and an accurate compressed flag", async () => {
    const { mod } = await loadModule();
    const bytes = new Uint8Array(128).fill(7);

    const compressed = await mod.uploadWithDedup(bytes, "a.bin", null, {
      compress: true,
    });

    expect(compressed.meta.bytes).toBe(bytes.length); // raw length, not gzipped
    expect(compressed.meta.compressed).toBe(true);
  });

  it("a worker-built dedup map (keyed by raw-content hash) hits a compressed main-thread save", async () => {
    const { mod, hashMod, writeToIPFS } = await loadModule();
    const bytes = new Uint8Array([42, 42, 42, 42, 1, 2, 3, 4]);
    const rawHash = hashMod.hashBytes(bytes);

    // The worker keys its dedup map by the raw-content hash.
    const workerDedupMap = new Map([[rawHash, "bafyWorkerCid"]]);

    const result = await mod.uploadWithDedup(
      bytes,
      "x.bin",
      null,
      { compress: true },
      workerDedupMap
    );

    expect(result.skipped).toBe(true);
    expect(result.cid).toBe("bafyWorkerCid");
    expect(writeToIPFS).not.toHaveBeenCalled();
  });
});
