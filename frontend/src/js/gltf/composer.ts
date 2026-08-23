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
} from "../ipfs/remote-ipfs.ts";
import { decompress } from "../asset-core/utils/compression.ts";
import { fetchCIDAsBase64 as fetchCIDAsBase64Cached } from "../asset-core/gltf/cache-aware-fetch.ts";
import { composeGltfJson } from "../asset-core/gltf/gltf-core.ts";

async function fetchCIDAsBase64(cid: string, arbeskMeta: any): Promise<string> {
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
 * @param gltfJson - The glTF JSON (composite ipfs:// refs or standard data URIs; dynamic schema)
 * @returns Standard glTF JSON with data URI buffers/images
 */
export async function composeGlTF(gltfJson: any): Promise<any> {
  if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");

  const composed = await composeGltfJson(gltfJson, fetchCIDAsBase64);

  console.log(
    `[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${
      composed.images?.length || 0
    } images`
  );
  return composed;
}
