/**
 * Async glTF Operations with Web Worker Offload
 *
 * These wrappers try to run heavy glTF work in a browser Web Worker and fall
 * back to the original main-thread implementations when workers are unavailable,
 * unsupported, or fail.
 */

import { getGlTFWorkerPool, isWorkerPoolAvailable } from "../workers/gltf-worker-pool.js";
import { writeToIPFS, writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { getUploadCredential, createBundle } from "../services/api.js";
import { getArrayBufferFromRemoteIPFS, gatewayBase } from "../ipfs/remote-ipfs.js";
import { composeGlTF } from "./composer.js";
import { decomposeGlTF as decomposeGlTFMain, decomposeAndStore as decomposeAndStoreMain, isComposite } from "./decomposer.js";
import { decomposeGLB as decomposeGLBMain, isGLB } from "./glb-parser.js";
import { editSourceColors as editSourceColorsMain } from "./source-color-editor.js";

const WORKER_BUFFER_PREFIX = "__worker_buffer_";
const WORKER_IMAGE_PREFIX = "__worker_image_";

let workerAvailable = null;

async function checkWorkerAvailable() {
  if (workerAvailable === null) {
    workerAvailable = await isWorkerPoolAvailable();
  }
  return workerAvailable;
}

/**
 * Upload extracted bytes and rewrite their placeholder URIs in `targets`.
 * @param {Array} items - extracted {bytes, name, skip} entries
 * @param {string} prefix - placeholder prefix (WORKER_BUFFER_PREFIX / WORKER_IMAGE_PREFIX)
 * @param {Array} targets - composite.buffers or composite.images
 * @param {object} [credential] - Optional reusable upload credential.
 * @returns {Promise[]} upload promises
 */
function uploadAndRewrite(items, prefix, targets, credential) {
  const uploads = [];
  items.forEach((item, idx) => {
    if (item.skip || !item.bytes) return;
    uploads.push(
      writeToIPFS(item.bytes, item.name, credential).then((cid) => {
        const placeholder = `${prefix}${idx}__`;
        for (const t of targets || []) {
          if (t.uri === placeholder) {
            t.uri = `ipfs://${cid}`;
          }
        }
      }),
    );
  });
  return uploads;
}

async function uploadExtractedAssets(composite, buffers, images, credential = null) {
  const reusableCredential = credential?.reusable ? credential : null;
  await Promise.all([
    ...uploadAndRewrite(buffers, WORKER_BUFFER_PREFIX, composite.buffers, reusableCredential),
    ...uploadAndRewrite(images, WORKER_IMAGE_PREFIX, composite.images, reusableCredential),
  ]);
  return composite;
}

/**
 * Assemble the composite glTF + its buffers/images into one IPFS directory
 * for organizational browsing (Pinata/Kubo show a browsable folder). Purely
 * additive — loading still uses the loose `ipfs://<cid>` refs in the composite.
 *
 * Best-effort: returns null on any failure so the asset still loads without a
 * bundle. Uses the extracted bytes already in memory (no re-fetch).
 *
 * @param {object} composite - composite glTF JSON (URIs already rewritten to ipfs://)
 * @param {Array} buffers - extracted {bytes, name} buffer entries
 * @param {Array} images - extracted {bytes, name} image entries
 * @returns {Promise<string|null>} directory root CID, or null on failure
 */
async function assembleBundle(composite, buffers, images) {
  try {
    const files = [];
    // The composite glTF JSON, by its friendly name.
    files.push({
      name: "composite.gltf",
      data: JSON.stringify(composite, null, 2),
    });
    // Each buffer/image under the same name the decomposer assigned.
    for (const b of buffers || []) {
      if (b && b.bytes && !b.skip) files.push({ name: b.name, data: b.bytes });
    }
    for (const img of images || []) {
      if (img && img.bytes && !img.skip) files.push({ name: img.name, data: img.bytes });
    }
    if (files.length <= 1) return null; // nothing to bundle beyond the JSON
    const { bundleCid } = await createBundle(files);
    console.log(`[BUNDLE] directory root → ${bundleCid} (${files.length} files)`);
    return bundleCid;
  } catch (err) {
    console.warn(`[BUNDLE] directory upload failed (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * Compose a composite glTF into a renderable glTF with data URIs.
 * Tries worker first; falls back to main-thread composer.js.
 *
 * @param {object} compositeJson
 * @param {string} gatewayBase - IPFS gateway base URL (e.g., "http://127.0.0.1:8080/ipfs")
 * @returns {Promise<object>} composed glTF JSON
 */
export async function composeGlTFAsync(compositeJson) {
  if (!compositeJson) throw new Error("composeGlTFAsync: gltfJson is null");

  if (await checkWorkerAvailable()) {
    try {
      const { composedJson } = await getGlTFWorkerPool().exec("compose", [{
        compositeJson,
        gatewayBase: await gatewayBase(),
      }]);
      return composedJson;
    } catch (error) {
      console.warn("[ASYNC-GLTF] compose worker failed, falling back:", error.message);
    }
  }

  return composeGlTF(compositeJson);
}

/**
 * Decompose a standard glTF JSON into a composite + extracted buffers/images.
 * Does NOT upload to IPFS; caller must upload returned bytes and rewrite URIs,
 * or use decomposeAndStoreAsync.
 *
 * @param {object} gltfJson
 * @returns {Promise<{composite: object, buffers: Array, images: Array}>}
 */
export async function decomposeGlTFAsync(gltfJson) {
  if (!gltfJson) throw new Error("decomposeGlTFAsync: gltf is null");

  if (await checkWorkerAvailable()) {
    try {
      return await getGlTFWorkerPool().exec("decomposeGltf", [{ gltfJson }]);
    } catch (error) {
      console.warn("[ASYNC-GLTF] decomposeGltf worker failed, falling back:", error.message);
    }
  }

  const composite = await decomposeGlTFMain(gltfJson);
  return { composite, buffers: [], images: [] };
}

/**
 * Decompose a standard glTF JSON and store the composite + components on IPFS.
 * Mirrors the original decomposeAndStore signature.
 *
 * @param {object} gltfJson
 * @returns {Promise<{composite: object, compositeCid: string}>}
 */
export async function decomposeAndStoreAsync(gltfJson) {
  const credential = await getUploadCredential();
  const reusableCredential = credential?.reusable ? credential : null;

  if (await checkWorkerAvailable()) {
    try {
      const { composite, buffers, images } = await getGlTFWorkerPool().exec("decomposeGltf", [{ gltfJson }]);
      await uploadExtractedAssets(composite, buffers, images, reusableCredential);
      const compositeCid = await writeJSONToIPFS(composite, reusableCredential);
      const bundleCid = await assembleBundle(composite, buffers, images);
      return { composite, compositeCid, bundleCid };
    } catch (error) {
      console.warn("[ASYNC-GLTF] decomposeAndStore worker failed, falling back:", error.message);
    }
  }

  const result = await decomposeAndStoreMain(gltfJson, reusableCredential);
  // Main-thread fallback has no extracted bytes array; skip bundling there.
  return { ...result, bundleCid: null };
}

/**
 * Decompose a GLB ArrayBuffer into a composite + extracted buffers/images.
 * Mirrors the original decomposeGLB signature when storeComposite is true.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {boolean} [storeComposite=true]
 * @returns {Promise<{composite: object, compositeCid: string|null}>}
 */
export async function decomposeGLBAsync(arrayBuffer, storeComposite = true) {
  if (!arrayBuffer) throw new Error("decomposeGLBAsync: arrayBuffer is required");

  const credential = await getUploadCredential();
  const reusableCredential = credential?.reusable ? credential : null;

  if (await checkWorkerAvailable()) {
    try {
      // Do not transfer the input ArrayBuffer: the worker receives a copy so
      // the original stays intact for the main-thread fallback if the worker
      // fails, and so its underlying buffer cannot collide with extracted
      // buffer transferables returned by the worker.
      const { composite, buffers, images } = await getGlTFWorkerPool().exec(
        "decomposeGlb",
        [{ arrayBuffer }],
      );
      await uploadExtractedAssets(composite, buffers, images, reusableCredential);

      let compositeCid = null;
      let bundleCid = null;
      if (storeComposite) {
        compositeCid = await writeJSONToIPFS(composite, reusableCredential);
        bundleCid = await assembleBundle(composite, buffers, images);
      }
      return { composite, compositeCid, bundleCid };
    } catch (error) {
      console.warn("[ASYNC-GLTF] decomposeGlb worker failed, falling back:", error.message);
    }
  }

  const result = await decomposeGLBMain(arrayBuffer, undefined, { storeComposite, credential: reusableCredential });
  return { ...result, bundleCid: null };
}

/**
 * Edit per-node source colors and upload the baked source asset.
 * Mirrors editSourceColors but offloads the color baking to a worker.
 *
 * @param {string} sourceCid
 * @param {object} nodeColors
 * @returns {Promise<{sourceCid: string, format?: string, path?: string, modified: number, skipped: number}>}
 */
export async function editSourceColorsAsync(sourceCid, nodeColors) {
  if (!sourceCid) throw new Error("editSourceColorsAsync: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf = null;
  let decomposedFromGlb = false;

  try {
    const buffer = await getArrayBufferFromRemoteIPFS(sourceCid);
    if (isGLB(buffer)) {
      const { composite } = await decomposeGLBAsync(buffer, false);
      gltf = composite;
      decomposedFromGlb = true;
    } else {
      gltf = JSON.parse(new TextDecoder().decode(buffer));
    }
  } catch (err) {
    console.warn(`[ASYNC-GLTF] failed to fetch ${sourceCid}: ${err.message}`);
    throw err;
  }

  if (await checkWorkerAvailable()) {
    try {
      const result = await getGlTFWorkerPool().exec("bakeSourceColors", [{
        gltfJson: gltf,
        nodeColors,
      }]);
      gltf = result.bakedJson;
      const newCid = await writeJSONToIPFS(gltf);
      const out = { sourceCid: newCid, format: "gltf", modified: result.modified, skipped: result.skipped };
      if (decomposedFromGlb) out.path = "composite.gltf";
      return out;
    } catch (error) {
      console.warn("[ASYNC-GLTF] bakeSourceColors worker failed, falling back:", error.message);
    }
  }

  return editSourceColorsMain(sourceCid, nodeColors);
}

export { isComposite };
