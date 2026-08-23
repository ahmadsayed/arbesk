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
 * cache (asset-core/utils/content-cache.js) for heavyweight buffers/images.
 */

import { getConfig } from "../services/api.ts";
import { isGzipped, decompress } from "../asset-core/utils/compression.ts";
import { arrayBufferToBase64 } from "../asset-core/utils/encoding.ts";
import { createConcurrencyLimiter } from "../asset-core/utils/concurrency.ts";

// Cap concurrent gateway reads to avoid head-of-line blocking when a composite
// has many buffers/images or when many library thumbnails load at once.
const DOWNLOAD_CONCURRENCY = 6;
const downloadLimiter = createConcurrencyLimiter(DOWNLOAD_CONCURRENCY);

// Coalesce concurrent downloads of the same CID so parallel compose/manifest
// loads don't fetch the same buffer/image/manifest multiple times.
const _inflightRawDownloads = new Map<string, Promise<Uint8Array>>();

const FALLBACK_GATEWAY = "http://127.0.0.1:8080/ipfs/";
let _gatewayPromise: Promise<string> | null = null;

async function gatewayBase(): Promise<string> {
  if (!_gatewayPromise) {
    _gatewayPromise = getConfig()
      .then((cfg) => cfg?.ipfsGatewayUrl || FALLBACK_GATEWAY)
      .catch(() => FALLBACK_GATEWAY);
  }
  return _gatewayPromise;
}

/**
 * @param onProgress - called with 0..1 as bytes
 *   arrive, when the gateway reports Content-Length. Only the caller that
 *   starts the download gets callbacks; coalesced joiners do not.
 */
async function fetchIpfsRawBytes(
  cid: string,
  onProgress?: (fraction: number) => void
): Promise<Uint8Array> {
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
      const chunks: Uint8Array[] = [];
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

async function fetchIpfsBytes(
  cid: string,
  onProgress?: (fraction: number) => void
): Promise<Uint8Array> {
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

async function fetchIpfsPayload(
  cid: string,
  kind: "json" | "blob" | "text",
  onProgress?: (fraction: number) => void
): Promise<any> {
  const bytes = await fetchIpfsBytes(cid, onProgress);

  if (kind === "blob") {
    return new Blob([bytes as BlobPart]);
  }

  const text = new TextDecoder().decode(bytes);
  if (kind === "json") {
    return JSON.parse(text);
  }
  return text;
}

async function getFromRemoteIPFS(cid: string): Promise<any> {
  const json = await fetchIpfsPayload(cid, "json");
  console.log(`[IPFS] got ${cid} | keys=${Object.keys(json).join(",")}`);
  return json;
}

async function getBase64FromRemoteIPFS(cid: string): Promise<string> {
  const bytes = await fetchIpfsBytes(cid);
  return arrayBufferToBase64(bytes.buffer as ArrayBuffer);
}

async function getBlobFromRemoteIPFS(
  cid: string,
  onProgress?: (fraction: number) => void
): Promise<Blob> {
  return await fetchIpfsPayload(cid, "blob", onProgress);
}

/**
 * @returns ArrayBuffer in practice; typed as any because
 *   out-of-scope callers (services/api.js toBounds) pass the result where a
 *   Uint8Array is declared.
 */
async function getArrayBufferFromRemoteIPFS(
  cid: string,
  onProgress?: (fraction: number) => void
): Promise<any> {
  const bytes = await fetchIpfsBytes(cid, onProgress);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

async function getRawArrayBufferFromRemoteIPFS(
  cid: string
): Promise<ArrayBufferLike> {
  const bytes = await fetchIpfsRawBytes(cid);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

interface ManifestChainEntry {
  cid: string;
  version: any;
  name: string | null;
  nodeCount: number;
}

/**
 * Walk a manifest chain backward via prev_asset_manifest_cid links.
 * Returns an array of { cid, version, name } summaries.
 */
async function getManifestChain(
  cid: string,
  maxDepth: number = 50
): Promise<ManifestChainEntry[]> {
  const chain: ManifestChainEntry[] = [];
  let current: string | null = cid;
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
async function isIpfsCidReachable(
  cid: string | null | undefined
): Promise<boolean> {
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
