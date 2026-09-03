/**
 * Main-thread glTF composer.
 * @remarks Thin wrapper around the shared compose logic in gltf-core.ts:
 *   resolves `ipfs://<CID>` refs to base64 data URIs, then serializes to
 *   bytes. Large buffers/images are cached by content hash so subsequent
 *   loads skip the IPFS gateway.
 */

import { getRuntime } from "../../runtime-state.ts";
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
 * Composes a composite glTF into a self-contained standard glTF, returned as
 * serialized JSON bytes.
 * @remarks Resolves every buffer/image URI to a base64 data URI so any
 *   standard loader can consume the result.
 * @param gltfJson - The glTF JSON (composite `ipfs://` refs or standard data URIs)
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
