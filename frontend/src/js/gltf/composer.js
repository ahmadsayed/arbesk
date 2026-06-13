/**
 * Arbesk glTF Composer
 *
 * Takes a composite glTF JSON (with `ipfs://<CID>` URI references for
 * buffers and images), fetches each component from IPFS, converts URIs
 * to base64 data URIs, and returns a standard glTF JSON ready for
 * Babylon.js SceneLoader.ImportMeshAsync.
 *
 * Also handles legacy glTF formats (base64 data URIs, CID-prefix URIs)
 * so it works as a drop-in replacement for `uri_to_cid.js → convertToDataURI`.
 */

import { getBase64FromRemoteIPFS, getBlobFromRemoteIPFS, getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

const IPFS_URI_PREFIX = "ipfs://";
const CID_BUFFER_PREFIX = "data:application/cid;base64,";
const BASE64_PREFIX = "data:application/octet-stream;base64,";

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
 *   - data:application/cid;base64,<CID>  → legacy CID ref, fetches and resolves
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

  // Legacy CID-prefix format
  if (uri.startsWith(CID_BUFFER_PREFIX)) {
    const cid = uri.replace(CID_BUFFER_PREFIX, "");
    const base64 = await getBase64FromRemoteIPFS(cid);
    return `${BASE64_PREFIX}${base64}`;
  }

  // Already a data URI — pass through
  if (uri.startsWith("data:")) {
    return uri;
  }

  // External URL or file path — pass through
  return uri;
}

/**
 * Compose a full standard glTF JSON from either a composite or legacy format.
 *
 * Resolves all buffer and image URIs to base64 data URIs so that
 * Babylon.js can load the result as a self-contained glTF.
 *
 * @param {object} gltfJson - The glTF JSON (composite or legacy)
 * @returns {Promise<object>} Standard glTF JSON with data URI buffers/images
 */
export async function composeGlTF(gltfJson) {
  if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");

  // Deep clone to avoid mutating the original
  const composed = JSON.parse(JSON.stringify(gltfJson));

  // Resolve buffer URIs
  if (composed.buffers) {
    for (let i = 0; i < composed.buffers.length; i++) {
      composed.buffers[i] = {
        ...composed.buffers[i],
        uri: await resolveURI(composed.buffers[i].uri, "application/octet-stream"),
      };
    }
  }

  // Resolve image URIs
  if (composed.images) {
    for (let i = 0; i < composed.images.length; i++) {
      const img = composed.images[i];
      if (!img.uri) continue;

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
    }
  }

  console.log(`[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${composed.images?.length || 0} images`);
  return composed;
}

export { resolveURI };
