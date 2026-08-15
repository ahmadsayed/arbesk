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
/** @type {Promise<string> | null} */
let _gatewayPromise = null;

/**
 * @returns {Promise<string>}
 */
async function gatewayBase() {
  if (!_gatewayPromise) {
    _gatewayPromise = getConfig()
      .then((cfg) => cfg?.ipfsGatewayUrl || FALLBACK_GATEWAY)
      .catch(() => FALLBACK_GATEWAY);
  }
  return _gatewayPromise;
}

/**
 * @param {string} cid
 * @param {(fraction: number) => void} [onProgress] - called with 0..1 as bytes
 *   arrive, when the gateway reports Content-Length. Only the caller that
 *   starts the download gets callbacks; coalesced joiners do not.
 */
async function fetchIpfsRawBytes(cid, onProgress) {
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
    const total = Number(response.headers?.get("Content-Length")) || 0;
    if (onProgress && total > 0 && response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress(Math.min(1, received / total));
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
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

/**
 * @param {string} cid
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
async function fetchIpfsBytes(cid, onProgress) {
  const bytes = await fetchIpfsRawBytes(cid, onProgress);
  if (isGzipped(bytes)) {
    const decompressed = decompress(bytes);
    console.log(
      `[IPFS] gunzipped ${bytes.byteLength} → ${decompressed.length} bytes`
    );
    return decompressed;
  }
  return bytes;
}

/**
 * @param {string} cid
 * @param {"json"|"blob"|"text"} kind
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<any>}
 */
async function fetchIpfsPayload(cid, kind, onProgress) {
  const bytes = await fetchIpfsBytes(cid, onProgress);

  if (kind === "blob") {
    return new Blob([/** @type {BlobPart} */ (bytes)]);
  }

  const text = new TextDecoder().decode(bytes);
  if (kind === "json") {
    return JSON.parse(text);
  }
  return text;
}

/**
 * @param {string} cid
 * @returns {Promise<any>}
 */
async function getFromRemoteIPFS(cid) {
  const json = await fetchIpfsPayload(cid, "json");
  console.log(`[IPFS] got ${cid} | keys=${Object.keys(json).join(",")}`);
  return json;
}

/**
 * @param {string} cid
 * @returns {Promise<string>}
 */
async function getBase64FromRemoteIPFS(cid) {
  const bytes = await fetchIpfsBytes(cid);
  return arrayBufferToBase64(/** @type {ArrayBuffer} */ (bytes.buffer));
}

/**
 * @param {string} cid
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
async function getBlobFromRemoteIPFS(cid, onProgress) {
  return await fetchIpfsPayload(cid, "blob", onProgress);
}

/**
 * @param {string} cid
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<any>} ArrayBuffer in practice; typed as any because
 *   out-of-scope callers (services/api.js toBounds) pass the result where a
 *   Uint8Array is declared.
 */
async function getArrayBufferFromRemoteIPFS(cid, onProgress) {
  const bytes = await fetchIpfsBytes(cid, onProgress);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

/**
 * @param {string} cid
 * @returns {Promise<ArrayBufferLike>}
 */
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
 *
 * @param {string} cid
 * @param {number} [maxDepth=50]
 * @returns {Promise<Array<{cid: string, version: any, name: string|null, nodeCount: number}>>}
 */
async function getManifestChain(cid, maxDepth = 50) {
  /** @type {Array<{cid: string, version: any, name: string|null, nodeCount: number}>} */
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
 *
 * @param {string|null|undefined} cid
 * @returns {Promise<boolean>}
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
