/**
 * Content cache unit tests.
 *
 * The cache module is designed to use IndexedDB in the browser, but these
 * tests exercise the in-memory backend so they run without a real IndexedDB
 * implementation.
 */

import { jest } from "@jest/globals";

// Force the cache module to see no global IndexedDB so it falls back to
// the in-memory store. We set this before importing the module under test.
globalThis.indexedDB = undefined;
globalThis.IDBKeyRange = undefined;

const {
  ContentCache,
  BIG_CONTENT_THRESHOLD_BYTES,
} = await import("../../frontend/src/js/utils/content-cache.js");

function bytes(text) {
  return new TextEncoder().encode(text);
}

function expectUint8ArrayEqual(actual, expected) {
  expect(actual instanceof Uint8Array).toBe(true);
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBe(expected[i]);
  }
}

describe("ContentCache (in-memory backend)", () => {
  let cache;

  beforeEach(() => {
    cache = new ContentCache({ memory: new Map() });
  });

  describe("getPayload", () => {
    it("returns null when the hash is not cached", async () => {
      const result = await cache.getPayload("00000000");
      expect(result).toBeNull();
    });

    it("returns the stored record when the hash is cached", async () => {
      const payload = bytes("hello world");
      await cache.putPayload("aabbccdd", "QmTest", false, payload);

      const result = await cache.getPayload("aabbccdd");
      expect(result).not.toBeNull();
      expect(result.hash).toBe("aabbccdd");
      expect(result.cid).toBe("QmTest");
      expect(result.compressed).toBe(false);
      expectUint8ArrayEqual(result.bytes, payload);
      expect(result.bytesCount).toBe(payload.length);
      expect(typeof result.storedAt).toBe("number");
    });

    it("stores compressed payloads as-is", async () => {
      const gzipped = bytes("fake-gzipped-bytes");
      await cache.putPayload("11223344", "QmCompressed", true, gzipped);

      const result = await cache.getPayload("11223344");
      expect(result.compressed).toBe(true);
      expectUint8ArrayEqual(result.bytes, gzipped);
    });
  });

  describe("putPayload", () => {
    it("stores a payload and makes it retrievable", async () => {
      const payload = bytes("payload one");
      await cache.putPayload("11111111", "QmOne", false, payload);

      const result = await cache.getPayload("11111111");
      expect(result.cid).toBe("QmOne");
      expectUint8ArrayEqual(result.bytes, payload);
    });

    it("overwrites an existing entry with the same hash", async () => {
      const first = bytes("first");
      const second = bytes("second-version");
      await cache.putPayload("22222222", "QmFirst", false, first);
      await cache.putPayload("22222222", "QmSecond", false, second);

      const result = await cache.getPayload("22222222");
      expect(result.cid).toBe("QmSecond");
      expectUint8ArrayEqual(result.bytes, second);
    });

    it("evicts the oldest entries when the byte cap would be exceeded", async () => {
      const smallCache = new ContentCache({
        memory: new Map(),
        maxBytes: 30,
      });

      const a = bytes("aaaaaaaaaa"); // 10 bytes
      const b = bytes("bbbbbbbbbb"); // 10 bytes
      const c = bytes("cccccccccc"); // 10 bytes
      const d = bytes("dddddddddddddddddddd"); // 20 bytes

      await smallCache.putPayload("a", "QmA", false, a);
      await smallCache.putPayload("b", "QmB", false, b);
      await smallCache.putPayload("c", "QmC", false, c);

      // Adding 20 bytes to a cache already at 30 bytes should evict oldest entries.
      await smallCache.putPayload("d", "QmD", false, d);

      expect(await smallCache.getPayload("a")).toBeNull();
      expect(await smallCache.getPayload("b")).toBeNull();
      expect(await smallCache.getPayload("c")).not.toBeNull();
      expect(await smallCache.getPayload("d")).not.toBeNull();
    });

    it("does not cache a single payload larger than the cap", async () => {
      const tinyCache = new ContentCache({
        memory: new Map(),
        maxBytes: 5,
      });

      const huge = bytes("huge-payload");
      await tinyCache.putPayload("big", "QmBig", false, huge);
      expect(await tinyCache.getPayload("big")).toBeNull();
    });
  });

  describe("clearCache", () => {
    it("removes all cached payloads", async () => {
      await cache.putPayload("x", "QmX", false, bytes("x"));
      await cache.putPayload("y", "QmY", false, bytes("y"));

      await cache.clearCache();

      expect(await cache.getPayload("x")).toBeNull();
      expect(await cache.getPayload("y")).toBeNull();
    });
  });

  describe("constants", () => {
    it("exposes the big-content threshold", () => {
      expect(BIG_CONTENT_THRESHOLD_BYTES).toBeGreaterThan(0);
    });
  });
});
