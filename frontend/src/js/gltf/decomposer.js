/**
 * Arbesk glTF Decomposer
 *
 * Takes a standard glTF 2.0 JSON (with data-URI buffers and images) and
 * decomposes it into individually content-addressed components on IPFS.
 *
 * Decomposition strategy:
 *   - buffers (.bin binary)  ->  stored individually on IPFS, referenced by CID
 *   - images (.png/.jpg/...)  ->  stored individually on IPFS, referenced by CID
 *   - materials, nodes, scenes, meshes, accessors, bufferViews, textures,
 *     samplers, animations, skins, cameras  ->  kept inline in the composite JSON
 *
 * The output is a "composite glTF" referencing components by `ipfs://<CID>`.
 * When a user edits material colors, only the composite CID changes;
 * buffers and images stay at their original CIDs (IPFS deduplication).
 */

import { sanitizeFileName } from "../utils/uri.js";
import { uploadWithDedup } from "./dedup.js";
import {
  IPFS_URI_PREFIX,
  isComposite,
  ipfsUriFromCid,
  attachDedupMeta,
  decomposeGltfJson,
} from "./gltf-core.js";

export { isComposite };

/**
 * Decompose a standard glTF JSON: extract buffers and images, store each
 * on IPFS, replace URIs with `ipfs://<CID>`, and return the composite JSON.
 *
 * If the glTF is already composite, it is returned as-is.
 *
 * @param {any} gltf - Standard glTF 2.0 JSON (with data-URI buffers/images; dynamic schema)
 * @param {import("../ipfs/upload-with-credential.js").UploadCredential|null} [credential=null] - Optional reusable upload credential.
 * @param {object} [options={}] - Decomposition options.
 * @param {boolean} [options.compress=true] - Gzip-compress buffers/images before upload.
 * @param {string} [options.assetName] - Asset name for IPFS filenames.
 * @param {string} [options.assetId] - Asset ID for IPFS filenames.
 * @param {Map<string, string>|null} [options.dedupMap=null] - Existing hash → CID map.
 * @returns {Promise<any>} Composite glTF JSON with ipfs:// URI references
 */
export async function decomposeGlTF(gltf, credential = null, options = {}) {
  const { compress = true, assetName, assetId, dedupMap = null } = options;
  const baseName = sanitizeFileName(/** @type {string} */ (assetName || assetId));
  if (!gltf) throw new Error("decomposeGlTF: gltf is null");

  // Already decomposed - nothing to do
  if (isComposite(gltf)) {
    console.log("[DECOMPOSE] glTF already composite, skipping");
    return gltf;
  }

  const stats = {
    buffers: 0,
    images: 0,
    bytesTotal: 0,
    skipped: 0,
  };
  // Pre-count already-decomposed refs in mixed composites.
  for (const buf of gltf.buffers || []) {
    if (buf.uri?.startsWith(IPFS_URI_PREFIX)) stats.buffers++;
  }
  for (const img of gltf.images || []) {
    if (img.uri?.startsWith(IPFS_URI_PREFIX)) stats.images++;
  }

  const composite = await decomposeGltfJson(gltf, {
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

  return composite;
}

/**
 * Decompose a glTF and store the composite JSON on IPFS.
 * Returns { composite, compositeCid }.
 *
 * @param {any} gltf - Standard glTF 2.0 JSON (dynamic schema)
 * @param {import("../ipfs/upload-with-credential.js").UploadCredential|null} [credential=null] - Optional reusable upload credential.
 * @param {object} [options={}] - Decomposition options.
 * @param {boolean} [options.compress=true] - Gzip-compress buffers/images before upload.
 * @param {string} [options.assetName] - Asset name for IPFS filenames.
 * @param {string} [options.assetId] - Asset ID for IPFS filenames.
 * @param {Map<string, string>|null} [options.dedupMap=null] - Existing hash → CID map.
 * @returns {Promise<{composite: any, compositeCid: string}>}
 */
export async function decomposeAndStore(gltf, credential = null, options = {}) {
  const { compress = true, assetName, assetId, dedupMap = null } = options;
  const composite = await decomposeGlTF(gltf, credential, {
    compress,
    assetName,
    assetId,
    dedupMap,
  });
  const { writeJSONToIPFS } = await import("../ipfs/write-to-ipfs.js");
  const baseName = sanitizeFileName(/** @type {string} */ (assetName || assetId));
  const compositeCid = await writeJSONToIPFS(composite, credential, {
    compress,
    assetId,
    filename: `${baseName}_composite.gltf`,
  });
  console.log(`[DECOMPOSE] composite stored → ${compositeCid}`);
  return { composite, compositeCid };
}
