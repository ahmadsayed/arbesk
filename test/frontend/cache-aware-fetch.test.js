/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import { gzipSync, gunzipSync } from "fflate";

const BIG_BYTES = 65 * 1024;

async function load({ cacheHits = new Map() } = {}) {
  jest.resetModules();

  const cacheGet = jest.fn(async (hash) => cacheHits.get(hash) || null);
  const cachePut = jest.fn(async () => true);

  jest.unstable_mockModule("../../frontend/src/js/utils/content-cache.js", () => ({
    __esModule: true,
    ContentCache: class {},
    BIG_CONTENT_THRESHOLD_BYTES: 64 * 1024,
    getPayload: cacheGet,
    putPayload: cachePut,
    clearCache: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/gltf/cache-aware-fetch.js");
  return { fetchCIDAsBase64: mod.fetchCIDAsBase64, cacheGet, cachePut };
}

function dataUriPayload(uri) {
  const prefix = "data:application/octet-stream;base64,";
  if (!uri.startsWith(prefix)) return null;
  const base64 = uri.slice(prefix.length);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

describe("fetchCIDAsBase64 cache-aware fetch", () => {
  it("returns cached bytes without calling fetchers when hash is cached", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0xab);
    const hash = "aabbccdd";
    const cid = "bafyCached";
    const { fetchCIDAsBase64, cacheGet, cachePut } = await load({
      cacheHits: new Map([[hash, { hash, cid, compressed: false, bytes: raw, bytesCount: raw.length }]]),
    });

    const fetchRaw = jest.fn();
    const fetchDecompressed = jest.fn();

    const base64 = await fetchCIDAsBase64(cid, { hash, hashAlgo: "murmur3-32", compressed: false, bytes: BIG_BYTES }, { fetchRaw, fetchDecompressed, decompress: gunzipSync });

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(cachePut).not.toHaveBeenCalled();
    expect(fetchRaw).not.toHaveBeenCalled();
    expect(fetchDecompressed).not.toHaveBeenCalled();
    const payload = dataUriPayload(`data:application/octet-stream;base64,${base64}`);
    expect(payload[0]).toBe(0xab);
  });

  it("fetches raw bytes and caches them on miss", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0xcd);
    const hash = "ccddeeff";
    const cid = "bafyMiss";
    const { fetchCIDAsBase64, cacheGet, cachePut } = await load();

    const fetchRaw = jest.fn(async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const fetchDecompressed = jest.fn();

    await fetchCIDAsBase64(cid, { hash, hashAlgo: "murmur3-32", compressed: false, bytes: BIG_BYTES }, { fetchRaw, fetchDecompressed, decompress: gunzipSync });

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(fetchRaw).toHaveBeenCalledWith(cid);
    expect(fetchDecompressed).not.toHaveBeenCalled();
    expect(cachePut).toHaveBeenCalledWith(hash, cid, false, expect.any(Uint8Array));
  });

  it("decompresses cached compressed payloads", async () => {
    const original = new Uint8Array(BIG_BYTES);
    for (let i = 0; i < BIG_BYTES; i++) original[i] = Math.floor(Math.random() * 256);
    const raw = gzipSync(original, { level: 1 });
    const hash = "11223344";
    const cid = "bafyCompressed";
    const { fetchCIDAsBase64, cachePut } = await load({
      cacheHits: new Map([[hash, { hash, cid, compressed: true, bytes: raw, bytesCount: raw.length }]]),
    });

    const base64 = await fetchCIDAsBase64(cid, { hash, hashAlgo: "murmur3-32", compressed: true, bytes: raw.length }, { fetchRaw: jest.fn(), fetchDecompressed: jest.fn(), decompress: gunzipSync });

    expect(cachePut).not.toHaveBeenCalled();
    const payload = dataUriPayload(`data:application/octet-stream;base64,${base64}`);
    expect(Buffer.from(payload).equals(Buffer.from(original))).toBe(true);
  });

  it("bypasses the cache for small payloads", async () => {
    const raw = new Uint8Array(1024).fill(0xef);
    const cid = "bafySmall";
    const { fetchCIDAsBase64, cacheGet, cachePut } = await load();

    const fetchRaw = jest.fn();
    const fetchDecompressed = jest.fn(async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

    await fetchCIDAsBase64(cid, { hash: "smallhash", hashAlgo: "murmur3-32", compressed: false, bytes: 1024 }, { fetchRaw, fetchDecompressed, decompress: gunzipSync });

    expect(cacheGet).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    expect(fetchRaw).not.toHaveBeenCalled();
    expect(fetchDecompressed).toHaveBeenCalledWith(cid);
  });

  it("uses the decompressed path when metadata is missing", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0x12);
    const cid = "bafyNoMeta";
    const { fetchCIDAsBase64, cacheGet, cachePut } = await load();

    const fetchRaw = jest.fn();
    const fetchDecompressed = jest.fn(async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

    await fetchCIDAsBase64(cid, null, { fetchRaw, fetchDecompressed, decompress: gunzipSync });

    expect(cacheGet).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    expect(fetchRaw).not.toHaveBeenCalled();
    expect(fetchDecompressed).toHaveBeenCalledWith(cid);
  });
});
