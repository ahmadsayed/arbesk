/**
 * Arbesk Remote IPFS Reader (Gateway-Only)
 *
 * All reads go through the private Kubo gateway (127.0.0.1:8080).
 * All writes go through the backend API (POST /api/assets/generate-node, etc.).
 *
 * Browser storage cache policy:
 * - cache only on demand, after a CID is explicitly opened/read by the user flow
 * - no prefetching or background warming
 * - cache entries are keyed by gateway URL + CID + payload kind
 */

const GATEWAY_URL =
  typeof process !== "undefined" && process.env && process.env.IPFS_GATEWAY_URL
    ? process.env.IPFS_GATEWAY_URL
    : "http://127.0.0.1:8080/ipfs/";

const IPFS_DB_NAME = "arbesk-ipfs-cache";
const IPFS_DB_VERSION = 1;
const IPFS_STORE = "responses";

/** @type {Map<string, string|Blob>} */
const memoryCache = new Map();
let dbPromise = null;

function buildCacheKey(cid, kind) {
  return `${GATEWAY_URL}${cid}::${kind}`;
}

async function openIpfsDb() {
  if (dbPromise) return dbPromise;

  if (typeof window === "undefined" || !("indexedDB" in window)) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IPFS_DB_NAME, IPFS_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IPFS_STORE)) {
          db.createObjectStore(IPFS_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn(
          "[IPFS] indexedDB unavailable:",
          request.error?.message || "open failed"
        );
        resolve(null);
      };
    } catch (error) {
      console.warn("[IPFS] indexedDB unavailable:", error.message);
      resolve(null);
    }
  });

  return dbPromise;
}

async function getFromBrowserStorage(key) {
  if (memoryCache.has(key)) {
    console.log(`[IPFS] memory hit ${key}`);
    return memoryCache.get(key);
  }

  const db = await openIpfsDb();
  if (!db) return null;

  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(IPFS_STORE, "readonly");
      const store = tx.objectStore(IPFS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result;
        if (!record) {
          resolve(null);
          return;
        }
        memoryCache.set(key, record.payload);
        console.log(`[IPFS] storage hit ${key}`);
        resolve(record.payload);
      };

      request.onerror = () => {
        console.warn(
          "[IPFS] indexedDB read failed:",
          request.error?.message || "read failed"
        );
        resolve(null);
      };
    } catch (error) {
      console.warn("[IPFS] indexedDB read failed:", error.message);
      resolve(null);
    }
  });
}

async function putInBrowserStorage(key, payload) {
  memoryCache.set(key, payload);

  const db = await openIpfsDb();
  if (!db) return;

  await new Promise((resolve) => {
    try {
      const tx = db.transaction(IPFS_STORE, "readwrite");
      const store = tx.objectStore(IPFS_STORE);
      store.put({
        key,
        payload,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn(
          "[IPFS] indexedDB write failed:",
          tx.error?.message || "write failed"
        );
        resolve();
      };
    } catch (error) {
      console.warn("[IPFS] indexedDB write failed:", error.message);
      resolve();
    }
  });
}

async function fetchAndCacheIpfsPayload(cid, kind) {
  const key = buildCacheKey(cid, kind);
  const cachedPayload = await getFromBrowserStorage(key);
  if (cachedPayload !== null) {
    return cachedPayload;
  }

  const url = `${GATEWAY_URL}${cid}`;
  console.log(`[IPFS] get ${url}`);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`IPFS gateway returned ${response.status} for ${cid}`);
  }

  let payload;
  if (kind === "blob") {
    payload = await response.blob();
  } else {
    payload = await response.text();
  }

  await putInBrowserStorage(key, payload);
  console.log(`[IPFS] cache store ${cid} (${kind})`);
  return payload;
}

async function getFromRemoteIPFS(cid) {
  const text = await fetchAndCacheIpfsPayload(cid, "json");
  const json = JSON.parse(text);
  console.log(`[IPFS] got ${cid} | keys=${Object.keys(json).join(",")}`);
  return json;
}

async function getBase64FromRemoteIPFS(cid) {
  return await fetchAndCacheIpfsPayload(cid, "text");
}

async function getBlobFromRemoteIPFS(cid) {
  return await fetchAndCacheIpfsPayload(cid, "blob");
}

/**
 * Traverse a fractal manifest history starting from a manifest CID.
 * Returns the variant entries for a specific node, or all nodes.
 */
async function getManifestHistory(cid, nodeId = null) {
  const manifest = await getFromRemoteIPFS(cid);
  if (!nodeId) {
    return manifest.scene?.nodes || [];
  }
  const node = (manifest.scene?.nodes || []).find((n) => n.node_id === nodeId);
  return node ? node.variants || [] : [];
}

export {
  getFromRemoteIPFS,
  getBase64FromRemoteIPFS,
  getBlobFromRemoteIPFS,
  getManifestHistory,
};
