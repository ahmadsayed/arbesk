// @ts-nocheck
/**
 * Arbesk Remote IPFS Reader (Gateway-Only)
 *
 * All reads go through the IPFS gateway reported by /api/v1/config.
 * All writes go through the backend API (POST /api/v1/generations, etc.).
 *
 * No app-level read cache: CID-addressed content is immutable, so the
 * browser's HTTP cache (Kubo serves /ipfs/ responses with immutable
 * cache headers) plus inflight request coalescing already cover repeat
 * reads. The glTF composition pipeline has its own memory + IndexedDB
 * cache (utils/content-cache.js) for heavyweight buffers/images.
 */

import { getConfig } from "../services/api.js";
import { isGzipped, decompress } from "../utils/compression.js";
import { arrayBufferToBase64 } from "../utils/encoding.js";
import { createConcurrencyLimiter } from "../utils/concurrency.js";

// Cap concurrent gateway reads to avoid head-of-line blocking when a composite
// has many buffers/images or when many library thumbnails load at once.
const DOWNLOAD_CONCURRENCY = 6;
const downloadLimiter = createConcurrencyLimiter(DOWNLOAD_CONCURRENCY);

// Coalesce concurrent downloads of the same CID so parallel compose/manifest
// loads don't fetch the same buffer/image/manifest multiple times.
const _inflightRawDownloads = new Map();

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

async function fetchIpfsRawBytes(cid) {
  const existing = _inflightRawDownloads.get(cid);
  if (existing) {
    return existing;
  }

  const downloadPromise = (async () => {
    const url = `${await gatewayBase()}${cid}`;
    console.log(`[IPFS] get ${url}`);
    const response = await downloadLimiter.run(() =>
      fetch(url, { cache: "default" })
    );
    if (!response.ok) {
      throw new Error(`IPFS gateway returned ${response.status} for ${cid}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  })();

  _inflightRawDownloads.set(cid, downloadPromise);
  downloadPromise
    .catch(() => {})
    .finally(() => {
      _inflightRawDownloads.delete(cid);
    });

  return downloadPromise;
}

async function fetchIpfsBytes(cid) {
  const bytes = await fetchIpfsRawBytes(cid);
  if (isGzipped(bytes)) {
    const decompressed = decompress(bytes);
    console.log(
      `[IPFS] gunzipped ${bytes.byteLength} → ${decompressed.length} bytes`
    );
    return decompressed;
  }
  return bytes;
}

async function fetchIpfsPayload(cid, kind) {
  const bytes = await fetchIpfsBytes(cid);

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
  const json = await fetchIpfsPayload(cid, "json");
  console.log(`[IPFS] got ${cid} | keys=${Object.keys(json).join(",")}`);
  return json;
}

async function getBase64FromRemoteIPFS(cid) {
  const bytes = await fetchIpfsBytes(cid);
  return arrayBufferToBase64(bytes.buffer);
}

async function getBlobFromRemoteIPFS(cid) {
  return await fetchIpfsPayload(cid, "blob");
}

async function getArrayBufferFromRemoteIPFS(cid) {
  const bytes = await fetchIpfsBytes(cid);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

async function getRawArrayBufferFromRemoteIPFS(cid) {
  const bytes = await fetchIpfsRawBytes(cid);
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
    const response = await downloadLimiter.run(() =>
      fetch(url, { method: "HEAD", cache: "default" })
    );
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
  getRawArrayBufferFromRemoteIPFS,
  getManifestChain,
  isIpfsCidReachable,
};
