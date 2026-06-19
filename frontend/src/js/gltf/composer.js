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

const IPFS_URI_PREFIX = "ipfs://";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

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

  // ipfs://<CID> — fetch binary
  if (uri.startsWith(IPFS_URI_PREFIX)) {
    const cid = uri.replace(IPFS_URI_PREFIX, "");
    const base64 = await fetchCIDAsBase64(cid);
    return `data:${defaultMime};base64,${base64}`;
  }

  // Already a data URI — pass through
  if (uri.startsWith("data:")) {
    return uri;
  }

  // External URL or file path — pass through
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

  // Deep clone to avoid mutating the original
  const composed = JSON.parse(JSON.stringify(gltfJson));

  // Resolve buffer URIs in parallel
  if (composed.buffers) {
    await Promise.all(
      composed.buffers.map(async (buf, i) => {
        composed.buffers[i] = {
          ...buf,
          uri: await resolveURI(buf.uri, "application/octet-stream"),
        };
      }),
    );
  }

  // Resolve image URIs in parallel
  if (composed.images) {
    await Promise.all(
      composed.images.map(async (img, i) => {
        if (!img.uri) return;

        // Detect MIME type from the URI or existing mimeType
        let mimeType = img.mimeType || "image/png";
        if (img.uri.startsWith(IPFS_URI_PREFIX) && !img.mimeType) {
          // We don't know the MIME type from the CID alone; default to PNG
          mimeType = "image/png";
        }

        composed.images[i] = {
          ...img,
          uri: await resolveURI(img.uri, mimeType),
        };
      }),
    );
  }

  console.log(`[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${composed.images?.length || 0} images`);
  return composed;
}

export { resolveURI };
