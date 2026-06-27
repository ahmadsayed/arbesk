// @ts-nocheck
/**
 * Persistent content-addressed cache for large glTF payloads.
 *
 * Uses IndexedDB when available in the browser, with an in-memory Map
 * fallback for environments (like Jest) that lack IndexedDB.
 *
 * Cache keys are the MurmurHash3 hex strings stored in each composite
 * glTF buffer/image under `_arbesk.hash`. Values are the exact stored
 * bytes (gzipped when `compressed` is true) so the key always matches
 * the bytes that were hashed at upload time.
 */

export const DB_NAME = "arbesk-content-cache";
export const STORE_NAME = "payloads";
export const DB_VERSION = 1;
export const MAX_CACHE_BYTES = 500 * 1024 * 1024; // 500 MB
export const BIG_CONTENT_THRESHOLD_BYTES = 64 * 1024; // 64 KB

function getIndexedDB() {
  return typeof indexedDB !== "undefined" ? indexedDB : null;
}

export class ContentCache {
  constructor(options = {}) {
    this._memory = options.memory || new Map();
    this._maxBytes = options.maxBytes ?? MAX_CACHE_BYTES;
    this._currentBytes = 0;
    this._dbPromise = options.db === null ? null : (options.db ? Promise.resolve(options.db) : this._openDb());
  }

  async _openDb() {
    const idb = getIndexedDB();
    if (!idb) return null;
    try {
      return await new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "hash" });
          }
        };
      });
    } catch (err) {
      console.warn("[CONTENT-CACHE] IndexedDB open failed:", err.message);
      return null;
    }
  }

  async _withStore(mode, fn) {
    const db = await this._dbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = fn(store);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }
    });
  }

  /**
   * Return the cached payload record for a hash, or null if not cached.
   *
   * Record shape: { hash, cid, compressed, bytes, bytesCount, storedAt }
   */
  async getPayload(hash) {
    // Fast path: in-memory cache.
    const memRecord = this._memory.get(hash);
    if (memRecord) {
      this._memory.delete(hash);
      this._memory.set(hash, memRecord);
      return memRecord;
    }

    // Persistent path: IndexedDB.
    const dbRecord = await this._getFromDb(hash);
    if (dbRecord) {
      // Promote to memory for fast reuse.
      this._memory.set(hash, dbRecord);
      this._currentBytes += dbRecord.bytesCount;
      this._evictIfNeeded(0);
      return dbRecord;
    }

    return null;
  }

  async _getFromDb(hash) {
    const data = await this._withStore("readonly", (store) =>
      store.get(hash)
    );
    if (!data) return null;
    return {
      hash: data.hash,
      cid: data.cid,
      compressed: data.compressed,
      bytes: data.bytes,
      bytesCount: data.bytesCount,
      storedAt: data.storedAt,
    };
  }

  /**
   * Store a payload in the cache. Evicts old entries if the byte cap
   * would be exceeded. Returns true if stored, false if the single payload
   * is larger than the cap.
   */
  async putPayload(hash, cid, compressed, bytes) {
    const bytesCount = bytes.length;

    if (bytesCount > this._maxBytes) {
      return false;
    }

    // Remove existing entry so we don't double-count bytes.
    if (this._memory.has(hash)) {
      const old = this._memory.get(hash);
      this._currentBytes -= old.bytesCount;
      this._memory.delete(hash);
    }

    this._evictIfNeeded(bytesCount);

    const record = {
      hash,
      cid,
      compressed,
      bytes,
      bytesCount,
      storedAt: Date.now(),
    };

    this._memory.set(hash, record);
    this._currentBytes += bytesCount;

    // Persist asynchronously; failures are non-fatal.
    this._putToDb(record).catch((err) =>
      console.warn("[CONTENT-CACHE] IndexedDB write failed:", err.message)
    );

    return true;
  }

  _evictIfNeeded(requiredBytes) {
    while (
      this._currentBytes + requiredBytes > this._maxBytes &&
      this._memory.size > 0
    ) {
      const firstKey = this._memory.keys().next().value;
      const first = this._memory.get(firstKey);
      this._currentBytes -= first.bytesCount;
      this._memory.delete(firstKey);
      this._deleteFromDb(firstKey).catch(() => {});
    }
  }

  async _putToDb(record) {
    await this._withStore("readwrite", (store) => store.put(record));
  }

  async _deleteFromDb(hash) {
    await this._withStore("readwrite", (store) => store.delete(hash));
  }

  /**
   * Remove every cached payload.
   */
  async clearCache() {
    this._memory.clear();
    this._currentBytes = 0;
    const db = await this._dbPromise;
    if (db) {
      await this._withStore("readwrite", (store) => store.clear());
    }
  }
}

// Default process-wide cache instance for browser use.
const _defaultCache = new ContentCache();

export async function getPayload(hash) {
  return _defaultCache.getPayload(hash);
}

export async function putPayload(hash, cid, compressed, bytes) {
  return _defaultCache.putPayload(hash, cid, compressed, bytes);
}

export async function clearCache() {
  return _defaultCache.clearCache();
}
