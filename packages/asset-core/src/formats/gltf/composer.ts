/**
 * Arbesk glTF Composer (main thread)
 *
 * Thin main-thread wrapper around the shared compose logic in gltf-core.ts:
 * resolves `ipfs://<CID>` buffer/image references to base64 data URIs so the
 * result is a self-contained glTF, then serializes it to bytes. This is the
 * `compose` half of the glTF FormatCodec (formats/codec.ts).
 *
 * Large buffers and images are cached locally by the content hash stored in
 * `_arbesk.hash` so subsequent loads can skip the IPFS gateway.
 */

import { getRuntime } from "../../runtime.ts";
import { decompress } from "../../utils/compression.ts";
import { fetchCIDAsBase64 as fetchCIDAsBase64Cached } from "./cache-aware-fetch.ts";
import { composeGltfJson } from "./gltf-core.ts";

async function fetchCIDAsBase64(cid: string, arbeskMeta: any): Promise<string> {
  console.log(`[COMPOSE] fetching ipfs://${cid}`);
  const { ipfsRead, kernels } = getRuntime();
  return fetchCIDAsBase64Cached(cid, arbeskMeta, {
    fetchRaw: (c) => ipfsRead.getRawBytes(c),
    fetchDecompressed: (c) => ipfsRead.getBytes(c),
    decompress,
    base64Encode: (bytes) => kernels.base64.encode(bytes),
  });
}

/**
 * Compose a composite glTF into a self-contained standard glTF, returned as
 * serialized JSON bytes (Uint8Array). Resolves every buffer/image URI to a
 * base64 data URI so any standard loader can consume the result.
 *
 * @param gltfJson - The glTF JSON (composite ipfs:// refs or standard data URIs; dynamic schema)
 * @returns Self-contained glTF JSON serialized to UTF-8 bytes
 */
export async function compose(gltfJson: any): Promise<Uint8Array> {
  if (!gltfJson) throw new Error("compose: gltfJson is null");

  const composed = await composeGltfJson(gltfJson, fetchCIDAsBase64);

  console.log(
    `[COMPOSE] resolved ${composed.buffers?.length || 0} buffers, ${
      composed.images?.length || 0
    } images`
  );
  return new TextEncoder().encode(JSON.stringify(composed));
}
