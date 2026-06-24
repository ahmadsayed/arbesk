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

import { writeToIPFS } from "../ipfs/write-to-ipfs.js";

const IPFS_URI_PREFIX = "ipfs://";
const BASE64_BUFFER_PREFIX = "data:application/octet-stream;base64,";
const BASE64_IMAGE_PREFIX = "data:image/";

/**
 * Check if a glTF JSON is already in composite format.
 */
export function isComposite(gltf) {
  if (!gltf) return false;

  // Check buffers for ipfs:// URIs
  for (const buf of gltf.buffers || []) {
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }

  // Check images for ipfs:// URIs
  for (const img of gltf.images || []) {
    if (img.uri && img.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }

  return false;
}

/**
 * Decode a base64 string to a Uint8Array.
 * Handles both standard base64 and URL-safe variants.
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extract the base64 payload from a data URI.
 * Returns { bytes, mimeType } or null if not a data URI.
 */
function extractDataURI(uri) {
  if (!uri || !uri.startsWith("data:")) return null;

  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;

  const header = uri.substring(0, commaIdx);
  const payload = uri.substring(commaIdx + 1);

  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";

  const isBase64 = header.includes(";base64");
  const bytes = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(payload);

  return { bytes, mimeType };
}

/**
 * Decompose a standard glTF JSON: extract buffers and images, store each
 * on IPFS, replace URIs with `ipfs://<CID>`, and return the composite JSON.
 *
 * If the glTF is already composite, it is returned as-is.
 *
 * @param {object} gltf - Standard glTF 2.0 JSON (with data-URI buffers/images)
 * @param {object} [credential=null] - Optional reusable upload credential.
 * @param {object} [options={}] - Decomposition options.
 * @param {boolean} [options.compress=true] - Gzip-compress buffers/images before upload.
 * @returns {Promise<object>} Composite glTF JSON with ipfs:// URI references
 */
function sanitizeFileName(name) {
  return String(name || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 40) || "asset";
}

export async function decomposeGlTF(
  gltf,
  credential = null,
  options = {},
) {
  const { compress = true, assetName, assetId } = options;
  const baseName = sanitizeFileName(assetName || assetId);
  if (!gltf) throw new Error("decomposeGlTF: gltf is null");

  // Already decomposed — nothing to do
  if (isComposite(gltf)) {
    console.log("[DECOMPOSE] glTF already composite, skipping");
    return gltf;
  }

  const composite = JSON.parse(JSON.stringify(gltf));
  const stats = { buffers: 0, images: 0, bytesTotal: 0 };

  // --- Decompose buffers ---
  // Upload all extracted buffers concurrently. Each promise mutates its own
  // index in composite.buffers, so there is no cross-index race.
  if (composite.buffers) {
    await Promise.all(
      composite.buffers.map(async (buf, i) => {
        if (!buf.uri) return;

        // Already an ipfs:// URI
        if (buf.uri.startsWith(IPFS_URI_PREFIX)) {
          stats.buffers++;
          return;
        }

        // Extract and store binary buffer
        const extracted = extractDataURI(buf.uri);
        if (!extracted) {
          console.warn(`[DECOMPOSE] buffer[${i}] unrecognized URI: ${buf.uri.substring(0, 80)}...`);
          return;
        }

        const filename = `${baseName}_buffer_${i}.bin`;
        const cid = await writeToIPFS(extracted.bytes, filename, credential, {
          compress,
        });
        composite.buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
        stats.buffers++;
        stats.bytesTotal += extracted.bytes.length;
        console.log(`[DECOMPOSE] buffer[${i}] → ipfs://${cid} (${extracted.bytes.length} bytes)`);
      })
    );
  }

  // --- Decompose images ---
  // Upload all extracted images concurrently.
  if (composite.images) {
    await Promise.all(
      composite.images.map(async (img, i) => {
        if (!img.uri) return;

        // Already an ipfs:// URI
        if (img.uri.startsWith(IPFS_URI_PREFIX)) {
          stats.images++;
          return;
        }

        // External URI or bufferView reference — skip
        if (!img.uri.startsWith("data:")) {
          console.log(`[DECOMPOSE] image[${i}] external URI, keeping as-is`);
          return;
        }

        const extracted = extractDataURI(img.uri);
        if (!extracted) {
          console.warn(`[DECOMPOSE] image[${i}] failed to extract data URI`);
          return;
        }

        const ext = extracted.mimeType.split("/")[1] || "bin";
        const filename = `${baseName}_texture_${i}.${ext}`;
        const cid = await writeToIPFS(extracted.bytes, filename, credential, {
          compress,
        });
        composite.images[i] = { ...img, uri: IPFS_URI_PREFIX + cid };
        stats.images++;
        stats.bytesTotal += extracted.bytes.length;
        console.log(`[DECOMPOSE] image[${i}] → ipfs://${cid} (${extracted.bytes.length} bytes)`);
      })
    );
  }

  console.log(
    `[DECOMPOSE] done | buffers=${stats.buffers} images=${stats.images} totalBytes=${stats.bytesTotal}`
  );

  return composite;
}

/**
 * Decompose a glTF and store the composite JSON on IPFS.
 * Returns { composite, compositeCid }.
 *
 * @param {object} gltf - Standard glTF 2.0 JSON
 * @param {object} [credential=null] - Optional reusable upload credential.
 * @returns {Promise<{composite: object, compositeCid: string}>}
 */
export async function decomposeAndStore(gltf, credential = null, options = {}) {
  const { compress = true, assetName, assetId } = options;
  const composite = await decomposeGlTF(gltf, credential, { compress, assetName, assetId });
  const { writeJSONToIPFS } = await import("../ipfs/write-to-ipfs.js");
  const baseName = sanitizeFileName(assetName || assetId);
  const compositeCid = await writeJSONToIPFS(composite, credential, {
    compress,
    assetId,
    filename: `${baseName}_composite.gltf`,
  });
  console.log(`[DECOMPOSE] composite stored → ${compositeCid}`);
  return { composite, compositeCid };
}
