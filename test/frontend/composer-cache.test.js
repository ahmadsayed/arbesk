/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";
import { gzip } from "pako";

if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

const BIG_BYTES = 65 * 1024; // above BIG_CONTENT_THRESHOLD_BYTES

function makeComposite(bufferMeta, imageMeta) {
  const composite = {
    asset: { version: "2.0" },
    buffers: bufferMeta.map((m) => ({
      uri: `ipfs://${m.cid}`,
      byteLength: m.byteLength,
      _arbesk: m.arbesk,
    })),
    images: imageMeta.map((m) => ({
      uri: `ipfs://${m.cid}`,
      mimeType: m.mimeType || "image/png",
      _arbesk: m.arbesk,
    })),
  };
  return composite;
}

async function loadComposer({ cacheHits = new Map(), fetchedRaw = new Map() } = {}) {
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

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    __esModule: true,
    gatewayBase: jest.fn(async () => "http://127.0.0.1:8080/ipfs/"),
    getFromRemoteIPFS: jest.fn(async () => ({})),
    getBase64FromRemoteIPFS: jest.fn(async () => ""),
    getBlobFromRemoteIPFS: jest.fn(async () => new Blob([])),
    getArrayBufferFromRemoteIPFS: jest.fn(async (cid) => {
      if (fetchedRaw.has(cid)) {
        const bytes = fetchedRaw.get(cid);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      throw new Error(`unexpected decompressed fetch for ${cid}`);
    }),
    getRawArrayBufferFromRemoteIPFS: jest.fn(async (cid) => {
      if (fetchedRaw.has(cid)) {
        const bytes = fetchedRaw.get(cid);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      throw new Error(`unexpected raw fetch for ${cid}`);
    }),
    getManifestChain: jest.fn(async () => []),
    isIpfsCidReachable: jest.fn(async () => true),
    clearRemoteIPFSCache: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/gltf/composer.js");
  return { composeGlTF: mod.composeGlTF, cacheGet, cachePut };
}

function dataUriPayload(uri) {
  const prefix = "data:application/octet-stream;base64,";
  if (!uri.startsWith(prefix)) return null;
  const base64 = uri.slice(prefix.length);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

describe("composeGlTF content-cache integration", () => {
  it("uses the cache for a large buffer and skips remote fetch", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0xab);
    const hash = "aabbccdd";
    const cid = "bafyBigBuffer";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      cacheHits: new Map([[hash, { hash, cid, compressed: false, bytes: raw, bytesCount: raw.length }]]),
    });

    const composite = makeComposite([{ cid, byteLength: BIG_BYTES, arbesk: { hash, hashAlgo: "murmur3-32", compressed: false, bytes: BIG_BYTES } }], []);
    const composed = await composeGlTF(composite);

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(cachePut).not.toHaveBeenCalled();
    const payload = dataUriPayload(composed.buffers[0].uri);
    expect(payload).not.toBeNull();
    expect(payload.length).toBe(BIG_BYTES);
    expect(payload[0]).toBe(0xab);
  });

  it("fetches raw bytes and caches them on a large buffer cache miss", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0xcd);
    const hash = "ccddeeff";
    const cid = "bafyMissBuffer";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      fetchedRaw: new Map([[cid, raw]]),
    });

    const composite = makeComposite([{ cid, byteLength: BIG_BYTES, arbesk: { hash, hashAlgo: "murmur3-32", compressed: false, bytes: BIG_BYTES } }], []);
    const composed = await composeGlTF(composite);

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(cachePut).toHaveBeenCalledWith(hash, cid, false, expect.any(Uint8Array));
    const payload = dataUriPayload(composed.buffers[0].uri);
    expect(payload).not.toBeNull();
    expect(payload.length).toBe(BIG_BYTES);
    expect(payload[0]).toBe(0xcd);
  });

  it("decompresses a cached compressed payload before base64 encoding", async () => {
    // Use random bytes so the gzipped payload stays large enough to cross
    // the cache threshold. Random data does not compress well.
    const original = new Uint8Array(BIG_BYTES);
    for (let i = 0; i < BIG_BYTES; i++) {
      original[i] = Math.floor(Math.random() * 256);
    }
    // Use level 1 compression in the test to keep the TDD loop fast.
    // The cache only cares that the stored bytes match the manifest hash.
    const raw = gzip(original, { level: 1 });
    expect(raw.length).toBeGreaterThanOrEqual(64 * 1024);
    const hash = "11223344";
    const cid = "bafyCompressed";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      cacheHits: new Map([[hash, { hash, cid, compressed: true, bytes: raw, bytesCount: raw.length }]]),
    });

    const composite = makeComposite([{ cid, byteLength: BIG_BYTES, arbesk: { hash, hashAlgo: "murmur3-32", compressed: true, bytes: raw.length } }], []);
    const composed = await composeGlTF(composite);

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(cachePut).not.toHaveBeenCalled();
    const payload = dataUriPayload(composed.buffers[0].uri);
    expect(payload).not.toBeNull();
    expect(Buffer.from(payload).equals(Buffer.from(original))).toBe(true);
  });

  it("bypasses the cache for small buffers", async () => {
    const raw = new Uint8Array(1024).fill(0xef);
    const hash = "eeeeffff";
    const cid = "bafySmallBuffer";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      fetchedRaw: new Map([[cid, raw]]),
    });

    const composite = makeComposite([{ cid, byteLength: 1024, arbesk: { hash, hashAlgo: "murmur3-32", compressed: false, bytes: 1024 } }], []);
    const composed = await composeGlTF(composite);

    expect(cacheGet).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    const payload = dataUriPayload(composed.buffers[0].uri);
    expect(payload).not.toBeNull();
    expect(payload.length).toBe(1024);
  });

  it("uses the existing decompressed fetch path when _arbesk metadata is missing", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0x12);
    const cid = "bafyNoMeta";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      fetchedRaw: new Map([[cid, raw]]),
    });

    const composite = makeComposite([{ cid, byteLength: BIG_BYTES, arbesk: null }], []);
    const composed = await composeGlTF(composite);

    expect(cacheGet).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
    const payload = dataUriPayload(composed.buffers[0].uri);
    expect(payload).not.toBeNull();
    expect(payload.length).toBe(BIG_BYTES);
  });

  it("uses the cache for large images", async () => {
    const raw = new Uint8Array(BIG_BYTES).fill(0x34);
    const hash = "44556677";
    const cid = "bafyBigImage";

    const { composeGlTF, cacheGet, cachePut } = await loadComposer({
      cacheHits: new Map([[hash, { hash, cid, compressed: false, bytes: raw, bytesCount: raw.length }]]),
    });

    const composite = makeComposite([], [{ cid, mimeType: "image/png", arbesk: { hash, hashAlgo: "murmur3-32", compressed: false, bytes: BIG_BYTES } }]);
    const composed = await composeGlTF(composite);

    expect(cacheGet).toHaveBeenCalledWith(hash);
    expect(cachePut).not.toHaveBeenCalled();
    expect(composed.images[0].uri.startsWith("data:image/png;base64,")).toBe(true);
  });
});
