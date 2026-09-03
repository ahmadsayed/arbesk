/**
 * Decomposes a standard glTF 2.0 JSON into content-addressed components on
 * IPFS.
 * @remarks Buffers and images are stored by CID while materials, nodes,
 *   scenes, and the rest stay inline in the composite JSON. Editing material
 *   colors changes only the composite CID; buffers and images keep their
 *   original CIDs (IPFS deduplication).
 */

import { sanitizeFileName } from "../../utils/uri.ts";
import { getRuntime } from "../../runtime-state.ts";
import { uploadWithDedup } from "./dedup.ts";
import {
  isComposite,
  ipfsUriFromCid,
  attachDedupMeta,
  decomposeGltfJson,
} from "./gltf-core.ts";
import type { DecomposeOptions } from "../codec.ts";

export { isComposite };

/**
 * Decomposes a standard glTF JSON into a composite, storing buffers/images
 * on IPFS and replacing their URIs with `ipfs://<CID>`.
 * @remarks If the glTF is already composite, extraction is skipped; with
 *   `store: true` it is still persisted so the caller always gets a
 *   `compositeCid`.
 * @param gltf - Standard glTF 2.0 JSON (with data-URI buffers/images)
 */
export async function decompose(
  gltf: any,
  opts: DecomposeOptions = {}
): Promise<{ composite: any; compositeCid?: string }> {
  const {
    compress = true,
    assetName,
    assetId,
    dedupMap = null,
    credential = null,
    store = true,
  } = opts;
  const baseName = sanitizeFileName((assetName || assetId) as string);
  if (!gltf) throw new Error("decompose: gltf is null");

  let composite: any;
  if (isComposite(gltf)) {
    console.log("[DECOMPOSE] glTF already composite, skipping extraction");
    composite = gltf;
  } else {
    const stats = {
      buffers: 0,
      images: 0,
      bytesTotal: 0,
      skipped: 0,
    };
    composite = await decomposeGltfJson(gltf, {
      onBuffer: async (i, buf, extracted) => {
        const filename = `${baseName}_buffer_${i}.bin`;
        const { cid, meta, skipped } = await uploadWithDedup(
          extracted.bytes,
          filename,
          credential,
          { compress },
          dedupMap
        );
        stats.buffers++;
        stats.bytesTotal += extracted.bytes.length;
        if (skipped) stats.skipped++;
        console.log(
          `[DECOMPOSE] buffer[${i}] → ipfs://${cid} (${extracted.bytes.length} bytes)${
            skipped ? " [dedup]" : ""
          }`
        );
        return attachDedupMeta({ ...buf, uri: ipfsUriFromCid(cid) }, meta);
      },
      onImage: async (i, img, extracted) => {
        const ext = extracted.mimeType.split("/")[1] || "bin";
        const filename = `${baseName}_texture_${i}.${ext}`;
        const { cid, meta, skipped } = await uploadWithDedup(
          extracted.bytes,
          filename,
          credential,
          { compress },
          dedupMap
        );
        stats.images++;
        stats.bytesTotal += extracted.bytes.length;
        if (skipped) stats.skipped++;
        console.log(
          `[DECOMPOSE] image[${i}] → ipfs://${cid} (${extracted.bytes.length} bytes)${
            skipped ? " [dedup]" : ""
          }`
        );
        return attachDedupMeta({ ...img, uri: ipfsUriFromCid(cid) }, meta);
      },
    });

    console.log(
      `[DECOMPOSE] done | buffers=${stats.buffers} images=${stats.images} skipped=${stats.skipped} totalBytes=${stats.bytesTotal}`
    );
  }

  let compositeCid: string | undefined;
  if (store) {
    compositeCid = await getRuntime().ipfsWrite.writeJSON(composite, credential, {
      compress,
      assetId,
      filename: `${baseName}_composite.gltf`,
    });
    console.log(`[DECOMPOSE] composite stored → ${compositeCid}`);
  }

  return { composite, compositeCid };
}
