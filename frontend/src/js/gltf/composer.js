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
 */

import { getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { arrayBufferToBase64 } from "../utils/encoding.js";
import { stripDedupMeta } from "./dedup.js";

const IPFS_URI_PREFIX = "ipfs://";

async function fetchCIDAsBase64(cid) {
  console.log(`[COMPOSE] fetching ipfs://${cid}`);
  const buffer = await getArrayBufferFromRemoteIPFS(cid);
  return arrayBufferToBase64(buffer);
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
 * @param {string} [defaultMime="application/octet-stream"] - MIME type for ipfs:// URIs
 * @returns {Promise<string>} Resolved data URI
 */
async function resolveURI(uri, defaultMime = "application/octet-stream") {
  if (!uri) return uri;

  // ipfs://<CID> - fetch binary
  if (uri.startsWith(IPFS_URI_PREFIX)) {
    const cid = uri.replace(IPFS_URI_PREFIX, "");
    const base64 = await fetchCIDAsBase64(cid);
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
        resolveURI(buf.uri, "application/octet-stream").then((uri) => {
          composed.buffers[i] = { ...buf, uri };
        })
      );
    });
  }
  if (composed.images) {
    composed.images.forEach((img, i) => {
      if (!img.uri) return;
      const mimeType =
        img.mimeType ||
        (img.uri.startsWith(IPFS_URI_PREFIX) ? "image/png" : "image/png");
      jobs.push(
        resolveURI(img.uri, mimeType).then((uri) => {
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
