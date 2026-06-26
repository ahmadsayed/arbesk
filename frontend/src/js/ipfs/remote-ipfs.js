/**
 * Arbesk Remote IPFS Reader (Gateway-Only)
 *
 * All reads go through the IPFS gateway reported by /api/v1/config.
 * All writes go through the backend API (POST /api/v1/generations, etc.).
 *
 * Browser caching (memory + IndexedDB) is DISABLED for development.
 * Every read hits the IPFS gateway directly to avoid stale-data confusion.
 * Re-enable by setting IPFS_CACHE_ENABLED = true.
 */

import { getConfig } from "../services/api.js";
import { isGzipped, decompress } from "../utils/compression.js";
import { arrayBufferToBase64 } from "../utils/encoding.js";

const IPFS_CACHE_ENABLED = true; // in-memory cache by CID (content-addressed, safe)
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB cap for raw gateway bytes
const MAX_CACHE_ENTRIES = 500; // Maximum number of cache entries to prevent Map overhead
const _cache = new Map();
let _cacheBytes = 0;

const FALLBACK_GATEWAY = "http://127.0.0.1:8080/ipfs/";
let _gatewayPromise = null;

async function gatewayBase() {
  if (!_gatewayPromise) {
    _gatewayPromise = getConfig()
      .then((cfg) => cfg?.ipfsGatewayUrl || FALLBACK_GATEWAY)
      .catch(() => FALLBACK_GATEWAY);
  }
  return _gatewayPromise;
}

async function fetchIpfsBytes(cid) {
  const url = `${await gatewayBase()}${cid}`;
  console.log(`[IPFS] get ${url}`);
  const response = await fetch(url, { cache: "default" });
  if (!response.ok) {
    throw new Error(`IPFS gateway returned ${response.status} for ${cid}`);
  }

  const buffer = await response.arrayBuffer();
  if (isGzipped(buffer)) {
    const decompressed = decompress(buffer);
    console.log(
      `[IPFS] gunzipped ${buffer.byteLength} → ${decompressed.length} bytes`
    );
    return decompressed;
  }
  return new Uint8Array(buffer);
}

function clearRemoteIPFSCache() {
  _cache.clear();
  _cacheBytes = 0;
}

function cacheBytes(cid, bytes) {
  if (!IPFS_CACHE_ENABLED) return;
  if (_cache.has(cid)) return;
  // Simple LRU eviction if adding this entry would exceed the byte cap or entry count.
  while (
    (_cacheBytes + bytes.length > MAX_CACHE_BYTES ||
      _cache.size >= MAX_CACHE_ENTRIES) &&
    _cache.size > 0
  ) {
    const firstKey = _cache.keys().next().value;
    const first = _cache.get(firstKey);
    _cacheBytes -= first?.bytes?.length || 0;
    _cache.delete(firstKey);
  }
  // Don't cache if this single entry exceeds the byte limit
  if (bytes.length > MAX_CACHE_BYTES) return;
  _cache.set(cid, { bytes, added: Date.now() });
  _cacheBytes += bytes.length;
}

async function fetchAndCacheIpfsPayload(cid, kind) {
  if (IPFS_CACHE_ENABLED && _cache.has(cid)) {
    const bytes = _cache.get(cid).bytes;
    if (kind === "blob") {
      return new Blob([bytes]);
    }
    const text = new TextDecoder().decode(bytes);
    if (kind === "json") {
      return JSON.parse(text);
    }
    return text;
  }

  const bytes = await fetchIpfsBytes(cid);
  cacheBytes(cid, bytes);

  if (kind === "blob") {
    return new Blob([bytes]);
  }

  const text = new TextDecoder().decode(bytes);
  if (kind === "json") {
    return JSON.parse(text);
  }
  return text;
}

async function getFromRemoteIPFS(cid) {
  const json = await fetchAndCacheIpfsPayload(cid, "json");
  console.log(`[IPFS] got ${cid} | keys=${Object.keys(json).join(",")}`);
  return json;
}

async function getBase64FromRemoteIPFS(cid) {
  const bytes = await fetchIpfsBytes(cid);
  return arrayBufferToBase64(bytes.buffer);
}

async function getBlobFromRemoteIPFS(cid) {
  return await fetchAndCacheIpfsPayload(cid, "blob");
}

async function getArrayBufferFromRemoteIPFS(cid) {
  const bytes = await fetchIpfsBytes(cid);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

/**
 * Walk a manifest chain backward via prev_asset_manifest_cid links.
 * Returns an array of { cid, version, name } summaries.
 */
async function getManifestChain(cid, maxDepth = 50) {
  const chain = [];
  let current = cid;
  while (current && chain.length < maxDepth) {
    try {
      const manifest = await getFromRemoteIPFS(current);
      chain.push({
        cid: current,
        version: manifest.version || 1,
        name: manifest.name || null,
        nodeCount: (manifest.scene?.nodes || []).length,
      });
      current = manifest.prev_asset_manifest_cid || null;
    } catch {
      break;
    }
  }
  return chain;
}

/**
 * Lightweight reachability probe for a CID on the configured gateway.
 * Returns true only if the gateway responds with a 2xx status.
 */
async function isIpfsCidReachable(cid) {
  if (!cid) return false;
  try {
    const url = `${await gatewayBase()}${cid}`;
    const response = await fetch(url, { method: "HEAD", cache: "default" });
    return response.ok;
  } catch {
    return false;
  }
}

export {
  gatewayBase,
  getFromRemoteIPFS,
  getBase64FromRemoteIPFS,
  getBlobFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
  getManifestChain,
  isIpfsCidReachable,
  clearRemoteIPFSCache,
};
