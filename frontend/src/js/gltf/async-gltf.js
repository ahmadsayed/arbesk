/**
 * Async glTF Operations with Web Worker Offload
 *
 * These wrappers try to run heavy glTF work in a browser Web Worker and fall
 * back to the original main-thread implementations when workers are unavailable,
 * unsupported, or fail.
 */

import { getGlTFWorkerPool, isWorkerPoolAvailable } from "../workers/gltf-worker-pool.js";
import { writeToIPFS, writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
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
 * @returns {Promise[]} upload promises
 */
function uploadAndRewrite(items, prefix, targets) {
  const uploads = [];
  items.forEach((item, idx) => {
    if (item.skip || !item.bytes) return;
    uploads.push(
      writeToIPFS(item.bytes, item.name).then((cid) => {
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

async function uploadExtractedAssets(composite, buffers, images) {
  await Promise.all([
    ...uploadAndRewrite(buffers, WORKER_BUFFER_PREFIX, composite.buffers),
    ...uploadAndRewrite(images, WORKER_IMAGE_PREFIX, composite.images),
  ]);
  return composite;
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
      const { composedJson } = await getGlTFWorkerPool().execute("compose", {
        compositeJson,
        gatewayBase: await gatewayBase(),
      });
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
      return await getGlTFWorkerPool().execute("decomposeGltf", { gltfJson });
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
  if (await checkWorkerAvailable()) {
    try {
      const { composite, buffers, images } = await getGlTFWorkerPool().execute("decomposeGltf", {
        gltfJson,
      });
      await uploadExtractedAssets(composite, buffers, images);
      const compositeCid = await writeJSONToIPFS(composite);
      return { composite, compositeCid };
    } catch (error) {
      console.warn("[ASYNC-GLTF] decomposeAndStore worker failed, falling back:", error.message);
    }
  }

  return decomposeAndStoreMain(gltfJson);
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

  if (await checkWorkerAvailable()) {
    try {
      // Do not transfer the input ArrayBuffer: the worker receives a copy so
      // the original stays intact for the main-thread fallback if the worker
      // fails, and so its underlying buffer cannot collide with extracted
      // buffer transferables returned by the worker.
      const { composite, buffers, images } = await getGlTFWorkerPool().execute(
        "decomposeGlb",
        { arrayBuffer },
      );
      await uploadExtractedAssets(composite, buffers, images);

      let compositeCid = null;
      if (storeComposite) {
        compositeCid = await writeJSONToIPFS(composite);
      }
      return { composite, compositeCid };
    } catch (error) {
      console.warn("[ASYNC-GLTF] decomposeGlb worker failed, falling back:", error.message);
    }
  }

  return decomposeGLBMain(arrayBuffer, undefined, { storeComposite });
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
      const result = await getGlTFWorkerPool().execute("bakeSourceColors", {
        gltfJson: gltf,
        nodeColors,
      });
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
