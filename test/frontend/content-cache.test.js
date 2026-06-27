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
  getPayload,
  putPayload,
  clearCache,
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

describe("ContentCache (fake IndexedDB backend)", () => {
  let storeMap;
  let fakeDb;
  let OriginalIDBRequest;

  beforeEach(() => {
    OriginalIDBRequest = globalThis.IDBRequest;
    globalThis.IDBRequest = class IDBRequest {};
    storeMap = new Map();
    const requests = [];

    function makeRequest(result) {
      const req = new IDBRequest();
      req.result = result;
      req.error = null;
      req.onsuccess = null;
      req.onerror = null;
      requests.push(req);
      return req;
    }

    function fireRequests() {
      // Fire any queued requests on the next microtask so _withStore has
      // time to attach onsuccess/onerror handlers.
      Promise.resolve().then(() => {
        for (const req of requests.splice(0)) {
          if (req.onsuccess) req.onsuccess();
        }
      });
    }

    const fakeStore = {
      get: jest.fn((hash) => {
        const req = makeRequest(storeMap.get(hash));
        fireRequests();
        return req;
      }),
      put: jest.fn((record) => {
        storeMap.set(record.hash, record);
        const req = makeRequest();
        fireRequests();
        return req;
      }),
      delete: jest.fn((hash) => {
        storeMap.delete(hash);
        const req = makeRequest();
        fireRequests();
        return req;
      }),
      clear: jest.fn(() => {
        storeMap.clear();
        const req = makeRequest();
        fireRequests();
        return req;
      }),
    };

    fakeDb = {
      transaction: jest.fn(() => ({
        objectStore: jest.fn(() => fakeStore),
        oncomplete: null,
        onerror: null,
      })),
    };
  });

  afterEach(() => {
    globalThis.IDBRequest = OriginalIDBRequest;
  });

  function makeCache(options = {}) {
    return new ContentCache({
      memory: new Map(),
      db: Promise.resolve(fakeDb),
      ...options,
    });
  }

  it("persists a payload to the fake IndexedDB", async () => {
    const cache = makeCache();
    const payload = bytes("db-bound");
    await cache.putPayload("hash1", "QmDb", false, payload);

    expect(storeMap.has("hash1")).toBe(true);
    expect(storeMap.get("hash1").cid).toBe("QmDb");
    expectUint8ArrayEqual(storeMap.get("hash1").bytes, payload);
  });

  it("promotes a DB record into memory when it is not in the memory cache", async () => {
    const record = {
      hash: "hash2",
      cid: "QmFromDb",
      compressed: false,
      bytes: bytes("from-db"),
      bytesCount: 7,
      storedAt: Date.now(),
    };
    storeMap.set("hash2", record);

    const cache = makeCache();
    const result = await cache.getPayload("hash2");

    expect(result.cid).toBe("QmFromDb");
    expectUint8ArrayEqual(result.bytes, record.bytes);
    expect(cache._currentBytes).toBe(7);
  });

  it("evicts from the fake DB when the byte cap is exceeded", async () => {
    const cache = makeCache({ maxBytes: 15 });
    await cache.putPayload("old", "QmOld", false, bytes("0123456789"));
    await cache.putPayload("new", "QmNew", false, bytes("abcdefghij"));

    // old should have been evicted from both memory and DB.
    expect(await cache.getPayload("old")).toBeNull();
    expect(storeMap.has("old")).toBe(false);
    expect(await cache.getPayload("new")).not.toBeNull();
  });

  it("clearCache removes payloads from memory and the fake DB", async () => {
    const cache = makeCache();
    await cache.putPayload("x", "QmX", false, bytes("x"));
    await cache.clearCache();

    expect(await cache.getPayload("x")).toBeNull();
    expect(storeMap.has("x")).toBe(false);
  });

  it("logs a warning when the DB write fails", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    function makeFailingRequest() {
      const req = new IDBRequest();
      req.result = undefined;
      req.error = new Error("disk full");
      req.onsuccess = null;
      req.onerror = null;
      Promise.resolve().then(() => {
        if (req.onerror) req.onerror();
      });
      return req;
    }

    const failingStore = {
      get: jest.fn(() => makeFailingRequest()),
      put: jest.fn(() => makeFailingRequest()),
      delete: jest.fn(() => makeFailingRequest()),
      clear: jest.fn(() => makeFailingRequest()),
    };
    const failingDb = {
      transaction: jest.fn(() => ({
        objectStore: jest.fn(() => failingStore),
        oncomplete: null,
        onerror: null,
      })),
    };
    const cache = new ContentCache({
      memory: new Map(),
      db: Promise.resolve(failingDb),
    });

    await cache.putPayload("fail", "QmFail", false, bytes("x"));
    // Wait for the async DB write to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("IndexedDB write failed"),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });
});

describe("ContentCache._openDb", () => {
  afterEach(() => {
    globalThis.indexedDB = undefined;
  });

  it("returns null when indexedDB is not available", async () => {
    jest.resetModules();
    globalThis.indexedDB = undefined;
    const mod = await import("../../frontend/src/js/utils/content-cache.js");
    const cache = new mod.ContentCache({ memory: new Map() });
    expect(await cache._dbPromise).toBeNull();
  });

  it("opens the database and handles onupgradeneeded", async () => {
    const store = { keyPath: "hash" };
    const db = {
      objectStoreNames: { contains: jest.fn(() => false) },
      createObjectStore: jest.fn(() => store),
    };
    const request = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };

    globalThis.indexedDB = {
      open: jest.fn(() => request),
    };

    jest.resetModules();
    const mod = await import("../../frontend/src/js/utils/content-cache.js");
    const cache = new mod.ContentCache({ memory: new Map() });

    // Defer firing so _openDb can attach handlers.
    Promise.resolve().then(() => {
      if (request.onupgradeneeded) {
        request.onupgradeneeded({ target: { result: db } });
      }
      if (request.onsuccess) request.onsuccess();
    });

    const opened = await cache._dbPromise;
    expect(opened).toBe(db);
    expect(db.createObjectStore).toHaveBeenCalledWith("payloads", { keyPath: "hash" });
  });

  it("returns null when IndexedDB open fails", async () => {
    const request = {
      result: null,
      error: new Error("denied"),
      onsuccess: null,
      onerror: null,
    };

    globalThis.indexedDB = {
      open: jest.fn(() => request),
    };

    jest.resetModules();
    const mod = await import("../../frontend/src/js/utils/content-cache.js");
    const cache = new mod.ContentCache({ memory: new Map() });

    Promise.resolve().then(() => {
      if (request.onerror) request.onerror();
    });

    expect(await cache._dbPromise).toBeNull();
  });
});

describe("module-level default cache helpers", () => {
  it("getPayload/putPayload/clearCache use the shared default cache", async () => {
    const payload = bytes("shared");
    await putPayload("sharedHash", "QmShared", false, payload);

    const result = await getPayload("sharedHash");
    expect(result.cid).toBe("QmShared");
    expectUint8ArrayEqual(result.bytes, payload);

    await clearCache();
    expect(await getPayload("sharedHash")).toBeNull();
  });
});
