/**
 * Arbesk glTF Composer (main thread)
 *
 * Thin main-thread wrapper around the shared compose logic in gltf-core.js:
 * resolves `ipfs://<CID>` buffer/image references to base64 data URIs so the
 * result is a self-contained glTF ready for Babylon.js SceneLoader.
 *
 * Large buffers and images are cached locally by the content hash stored in
 * `_arbesk.hash` so subsequent loads can skip the IPFS gateway.
 */

import {
  getArrayBufferFromRemoteIPFS,
  getRawArrayBufferFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { decompress } from "../utils/compression.js";
import { fetchCIDAsBase64 as fetchCIDAsBase64Cached } from "./cache-aware-fetch.js";
import { composeGltfJson } from "./gltf-core.js";

/**
 * @param {string} cid
 * @param {any} arbeskMeta
 * @returns {Promise<string>}
 */
async function fetchCIDAsBase64(cid, arbeskMeta) {
  console.log(`[COMPOSE] fetching ipfs://${cid}`);
  return fetchCIDAsBase64Cached(cid, arbeskMeta, {
    fetchRaw: getRawArrayBufferFromRemoteIPFS,
    fetchDecompressed: getArrayBufferFromRemoteIPFS,
    decompress,
  });
}

/**
 * Compose a full standard glTF JSON from a composite or standard glTF.
 *
 * Resolves all buffer and image URIs to base64 data URIs so that
 * Babylon.js can load the result as a self-contained glTF.
 *
 * @param {any} gltfJson - The glTF JSON (composite ipfs:// refs or standard data URIs; dynamic schema)
 * @returns {Promise<any>} Standard glTF JSON with data URI buffers/images
 */
export async function composeGlTF(gltfJson) {
  if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");

  const composed = await composeGltfJson(gltfJson, fetchCIDAsBase64);

  console.log(
    `[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${
      composed.images?.length || 0
    } images`
  );
  return composed;
}
