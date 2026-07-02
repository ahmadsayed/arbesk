// @ts-nocheck
/**
 * Arbesk glTF Composer
 *
 * Takes a composite glTF JSON (with `ipfs://<CID>` URI references for
 * buffers and images), fetches each component from IPFS, converts URIs
 * to base64 data URIs, and returns a standard glTF JSON ready for
 * Babylon.js SceneLoader.ImportMeshAsync.
 *
 * Already-resolved data URIs are passed through unchanged.
 *
 * Large buffers and images are cached locally by the MurmurHash3 hash
 * stored in `_arbesk.hash` so subsequent loads can skip the IPFS gateway.
 * Manifests and small payloads are always fetched from IPFS.
 */

import {
  getArrayBufferFromRemoteIPFS,
  getRawArrayBufferFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { decompress } from "../utils/compression.js";
import { fetchCIDAsBase64 as fetchCIDAsBase64Cached } from "./cache-aware-fetch.js";
import { stripDedupMeta } from "./dedup.js";

const IPFS_URI_PREFIX = "ipfs://";

async function fetchCIDAsBase64(cid, arbeskMeta) {
  console.log(`[COMPOSE] fetching ipfs://${cid}`);
  return fetchCIDAsBase64Cached(cid, arbeskMeta, {
    fetchRaw: getRawArrayBufferFromRemoteIPFS,
    fetchDecompressed: getArrayBufferFromRemoteIPFS,
    decompress,
  });
}

/**
 * Resolve a single URI to a base64 data URI.
 *
 * Handles:
 *   - ipfs://<CID>        → fetches binary, returns data:...;base64,...
 *   - data:...;base64,...  → already resolved, return as-is
 *   - anything else        → return as-is
 *
 * @param {string} uri - The URI to resolve
 * @param {object} [arbeskMeta] - Optional `_arbesk` metadata for content-addressed cache lookup
 * @param {string} [defaultMime="application/octet-stream"] - MIME type for ipfs:// URIs
 * @returns {Promise<string>} Resolved data URI
 */
async function resolveURI(
  uri,
  arbeskMeta = null,
  defaultMime = "application/octet-stream"
) {
  if (!uri) return uri;

  // ipfs://<CID> - fetch binary
  if (uri.startsWith(IPFS_URI_PREFIX)) {
    const cid = uri.replace(IPFS_URI_PREFIX, "");
    const base64 = await fetchCIDAsBase64(cid, arbeskMeta);
    return `data:${defaultMime};base64,${base64}`;
  }

  // Already a data URI - pass through
  if (uri.startsWith("data:")) {
    return uri;
  }

  // External URL or file path - pass through
  return uri;
}

/**
 * Compose a full standard glTF JSON from a composite or standard glTF.
 *
 * Resolves all buffer and image URIs to base64 data URIs so that
 * Babylon.js can load the result as a self-contained glTF.
 *
 * @param {object} gltfJson - The glTF JSON (composite ipfs:// refs or standard data URIs)
 * @returns {Promise<object>} Standard glTF JSON with data URI buffers/images
 */
export async function composeGlTF(gltfJson) {
  if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");

  // Deep clone to avoid mutating the original, and strip Arbesk metadata so
  // Babylon.js receives a standard glTF JSON.
  const composed = stripDedupMeta(gltfJson);

  // Resolve buffer and image URIs in parallel
  const jobs = [];
  if (composed.buffers) {
    composed.buffers.forEach((buf, i) => {
      jobs.push(
        resolveURI(buf.uri, gltfJson.buffers?.[i]?._arbesk, "application/octet-stream").then((uri) => {
          composed.buffers[i] = { ...buf, uri };
        })
      );
    });
  }
  if (composed.images) {
    composed.images.forEach((img, i) => {
      if (!img.uri) return;
      const mimeType = img.mimeType || "image/png";
      jobs.push(
        resolveURI(img.uri, gltfJson.images?.[i]?._arbesk, mimeType).then((uri) => {
          composed.images[i] = { ...img, uri };
        })
      );
    });
  }
  await Promise.all(jobs);

  console.log(
    `[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${
      composed.images?.length || 0
    } images`
  );
  return composed;
}

export { resolveURI };
