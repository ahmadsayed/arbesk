/**
 * Arbesk Remote IPFS Reader (Gateway-Only)
 *
 * All reads go through the private Kubo gateway (127.0.0.1:8080).
 * All writes go through the backend API (POST /api/v1/generations, etc.).
 *
 * Browser caching (memory + IndexedDB) is DISABLED for development.
 * Every read hits the IPFS gateway directly to avoid stale-data confusion.
 * Re-enable by setting IPFS_CACHE_ENABLED = true.
 */

const IPFS_CACHE_ENABLED = false; // flip to true to re-enable browser caching

const GATEWAY_URL =
  typeof process !== "undefined" && process.env && process.env.IPFS_GATEWAY_URL
    ? process.env.IPFS_GATEWAY_URL
    : "http://127.0.0.1:8080/ipfs/";

async function fetchAndCacheIpfsPayload(cid, kind) {
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

async function getArrayBufferFromRemoteIPFS(cid) {
  const url = `${GATEWAY_URL}${cid}`;
  console.log(`[IPFS] getArrayBuffer ${url}`);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`IPFS gateway returned ${response.status} for ${cid}`);
  }
  return await response.arrayBuffer();
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
    const url = `${GATEWAY_URL}${cid}`;
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export {
  getFromRemoteIPFS,
  getBase64FromRemoteIPFS,
  getBlobFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
  getManifestChain,
  isIpfsCidReachable,
};
