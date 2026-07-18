// @ts-nocheck
/**
 * Async glTF Operations with Web Worker Offload
 *
 * These wrappers try to run heavy glTF work in a browser Web Worker and fall
 * back to the original main-thread implementations when workers are unavailable,
 * unsupported, or fail.
 */

import {
  getGlTFWorkerPool,
  isWorkerPoolAvailable,
} from "../workers/gltf-worker-pool.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { getUploadCredentials } from "../services/api.js";
import {
  getArrayBufferFromRemoteIPFS,
  gatewayBase,
} from "../ipfs/remote-ipfs.js";
import { composeGlTF } from "./composer.js";
import {
  decomposeGlTF as decomposeGlTFMain,
  decomposeAndStore as decomposeAndStoreMain,
  isComposite,
} from "./decomposer.js";
import { decomposeGLB as decomposeGLBMain, isGLB } from "./glb-parser.js";
import { editSourceColors as editSourceColorsMain } from "./source-color-editor.js";

function sanitizeAsyncName(name) {
  return (
    String(name || "asset")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .slice(0, 40) || "asset"
  );
}

let workerAvailable = null;

async function checkWorkerAvailable() {
  if (workerAvailable === null) {
    workerAvailable = await isWorkerPoolAvailable();
  }
  return workerAvailable;
}

/**
 * Upper-bound count of IPFS uploads a glTF decompose will need (buffers +
 * images + the composite JSON itself). Deliberately a loose upper bound
 * rather than mirroring decomposeGltf's exact skip logic (already-ipfs://
 * refs, external image URIs) - a few unused pooled credentials just expire
 * unused, while under-counting would starve the pool mid-upload.
 */
function estimateUploadCount(gltfJson) {
  return (gltfJson?.buffers?.length || 0) + (gltfJson?.images?.length || 0) + 1;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_HEADER_LENGTH = 12;
const GLB_CHUNK_HEADER_LENGTH = 8;

/**
 * Cheaply peek a GLB's embedded JSON chunk to size the credential pool,
 * without pulling in the full gltf-transform parser on the main thread.
 * Falls back to a conservative fixed estimate if the header can't be read.
 */
function estimateGlbUploadCount(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) !== GLB_MAGIC) return 8;
    const jsonChunkLength = view.getUint32(GLB_HEADER_LENGTH, true);
    const jsonBytes = new Uint8Array(
      arrayBuffer,
      GLB_HEADER_LENGTH + GLB_CHUNK_HEADER_LENGTH,
      jsonChunkLength
    );
    return estimateUploadCount(
      JSON.parse(new TextDecoder().decode(jsonBytes))
    );
  } catch {
    return 8;
  }
}

// Matches the backend's uploadUrlsSchema cap (src/api/schemas.js). Clamped
// client-side so an unusually large decompose (many discrete buffers/images)
// degrades to a smaller pool - triggering the existing worker-failure ->
// main-thread fallback path - instead of the mint request itself failing
// with HTTP 400.
const MAX_POOLED_CREDENTIALS = 200;

/**
 * Mint an upload credential sized for a batch of `count` files in one round
 * trip. Kubo credentials are already reusable across unlimited uploads, so
 * `count` only matters for Pinata: its signed URLs are strictly single-use
 * (verified: a second upload against the same URL gets HTTP 409 "duplicate
 * file id"), so uploading N files previously meant N sequential
 * backend + Pinata mint round trips. This mints all N up front instead.
 *
 * @param {number} count
 * @returns {Promise<object>}
 */
async function getPooledUploadCredential(count) {
  const clamped = Math.min(Math.max(count, 1), MAX_POOLED_CREDENTIALS);
  const credentials = await getUploadCredentials(clamped);
  const first = credentials[0];
  if (!first) {
    throw new Error("getPooledUploadCredential: no credentials returned");
  }
  if (first.backend !== "pinata") return first;
  return {
    backend: "pinata",
    gateway: first.gateway,
    urls: credentials.map((c) => c.url),
    reusable: true,
  };
}

/**
 * Carve one URL off a pooled Pinata credential for a follow-up upload that
 * happens on the main thread AFTER a worker call that also draws from the
 * pool.
 *
 * Necessary because `workerPool.exec()` passes the credential through
 * structured clone: the worker mutates its OWN copy of `credential.urls` as
 * it uploads, and the main thread's copy is never touched. Without this, a
 * post-worker upload (e.g. the composite JSON) would pop url[0] from the
 * still-full main-thread copy - a URL the worker already spent inside its
 * clone - and get HTTP 409 "duplicate file id" from Pinata.
 *
 * Reserving one URL up front sidesteps the clone desync entirely: the worker
 * gets a pool one shorter, the main thread gets a single dedicated URL, and
 * neither can collide with the other.
 *
 * No-op for kubo (or an already single-shot credential) since there's no
 * clone-desync risk to guard against.
 *
 * @param {object} credential
 * @returns {{workerCredential: object, followUpCredential: object}}
 */
function reserveFollowUpCredential(credential) {
  if (credential?.backend === "pinata" && credential.urls?.length > 1) {
    const urls = credential.urls.slice();
    const reservedUrl = urls.pop();
    return {
      workerCredential: { ...credential, urls },
      followUpCredential: {
        backend: "pinata",
        url: reservedUrl,
        gateway: credential.gateway,
        reusable: false,
      },
    };
  }
  return { workerCredential: credential, followUpCredential: credential };
}

/**
 * Assemble the composite glTF + its buffers/images into one IPFS directory
 * for organizational browsing (Pinata/Kubo show a browsable folder). Purely
 * additive - loading still uses the loose `ipfs://<cid>` refs in the composite.
 *
 * Best-effort: returns null on any failure so the asset still loads without a
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
      const { composedJson } = await getGlTFWorkerPool().exec("compose", [
        {
          compositeJson,
          gatewayBase: await gatewayBase(),
        },
      ]);
      return composedJson;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] compose worker failed, falling back:",
        error.message
      );
    }
  }

  return composeGlTF(compositeJson);
}

/**
 * Compose a composite glTF into a renderable Blob of glTF JSON.
 *
 * Worker path: the worker composes, stringifies, and encodes the glTF, then
 * transfers the bytes zero-copy — the main thread never holds the composed
 * JSON object or pays a giant JSON.stringify. Fallback matches the previous
 * behavior: main-thread composeGlTF() + JSON.stringify wrapped in a Blob.
 *
 * @param {object} compositeJson
 * @returns {Promise<Blob>} application/json Blob ready for a blob URL
 */
export async function composeGlTFToBlobAsync(compositeJson) {
  if (!compositeJson) {
    throw new Error("composeGlTFToBlobAsync: gltfJson is null");
  }

  if (await checkWorkerAvailable()) {
    try {
      const { composedBytes } = await getGlTFWorkerPool().exec(
        "composeToBytes",
        [
          {
            compositeJson,
            gatewayBase: await gatewayBase(),
          },
        ]
      );
      return new Blob([composedBytes], { type: "application/json" });
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] composeToBytes worker failed, falling back:",
        error.message
      );
    }
  }

  const composed = await composeGlTF(compositeJson);
  return new Blob([JSON.stringify(composed)], { type: "application/json" });
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
      console.warn(
        "[ASYNC-GLTF] decomposeGltf worker failed, falling back:",
        error.message
      );
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
export async function decomposeAndStoreAsync(gltfJson, options = {}) {
  const { assetName, assetId, dedupMap = null } = options;
  const credential = await getPooledUploadCredential(
    estimateUploadCount(gltfJson)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkWorkerAvailable())) {
    try {
      // Worker path: extraction + batched IPFS upload happen off the main thread.
      // Components are stored uncompressed because the worker cannot import fflate.
      // The composite JSON is written back on the main thread afterward, so its
      // credential is reserved up front (see reserveFollowUpCredential) rather
      // than shared with the worker's clone of the pool.
      const { workerCredential, followUpCredential } =
        reserveFollowUpCredential(reusableCredential);
      const { composite } = await getGlTFWorkerPool().exec(
        "decomposeAndUploadGltf",
        [{ gltfJson, credential: workerCredential, options: { dedupMap } }]
      );
      const compositeCid = await writeJSONToIPFS(
        composite,
        followUpCredential,
        {
          compress: true,
          assetId,
          filename:
            assetName || assetId
              ? `${sanitizeAsyncName(assetName || assetId)}_composite.gltf`
              : undefined,
        }
      );
      return { composite, compositeCid };
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] decomposeAndUploadGltf worker failed, falling back:",
        error.message
      );
    }
  }

  const result = await decomposeAndStoreMain(gltfJson, reusableCredential, {
    compress: true,
    assetName,
    assetId,
    dedupMap,
  });
  return result;
}

/**
 * Decompose a GLB ArrayBuffer into a composite + extracted buffers/images.
 * Mirrors the original decomposeGLB signature when storeComposite is true.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {boolean} [storeComposite=true]
 * @param {object} [options]
 * @param {string} [options.assetName]
 * @param {string} [options.assetId]
 * @param {Map<string, string>} [options.dedupMap]
 * @returns {Promise<{composite: object, compositeCid: string|null}>}
 */
export async function decomposeGLBAsync(
  arrayBuffer,
  storeComposite = true,
  options = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!arrayBuffer)
    throw new Error("decomposeGLBAsync: arrayBuffer is required");

  const credential = await getPooledUploadCredential(
    estimateGlbUploadCount(arrayBuffer)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkWorkerAvailable())) {
    try {
      // Worker path: extraction + batched IPFS upload happen off the main thread.
      const { composite, compositeCid } = await getGlTFWorkerPool().exec(
        "decomposeAndUploadGlb",
        [{
          arrayBuffer,
          credential: reusableCredential,
          options: {
            storeComposite,
            assetName,
            assetId,
            dedupMap,
          },
        }]
      );
      return { composite, compositeCid };
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] decomposeAndUploadGlb worker failed, falling back:",
        error.message
      );
    }
  }

  const result = await decomposeGLBMain(arrayBuffer, undefined, {
    storeComposite,
    credential: reusableCredential,
    compress: true,
    assetName,
    assetId,
    dedupMap,
  });
  return result;
}

/**
 * Edit per-node source colors and upload the baked source asset.
 * Mirrors editSourceColors but offloads the color baking to a worker.
 *
 * @param {string} sourceCid
 * @param {object} nodeColors
 * @param {object} [options] - Optional parameters
 * @param {string} [options.assetName] - Asset name for IPFS filename
 * @param {string} [options.assetId] - Asset ID for IPFS filename
 * @param {Map<string, string>} [options.dedupMap]
 * @returns {Promise<{sourceCid: string, format?: string, path?: string, modified: number, skipped: number}>}
 */
export async function editSourceColorsAsync(
  sourceCid,
  nodeColors,
  options = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid)
    throw new Error("editSourceColorsAsync: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf = null;
  let decomposedFromGlb = false;

  try {
    const buffer = await getArrayBufferFromRemoteIPFS(sourceCid);
    if (isGLB(buffer)) {
      const { composite } = await decomposeGLBAsync(buffer, false, {
        dedupMap,
      });
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
      const result = await getGlTFWorkerPool().exec("bakeSourceColors", [
        {
          gltfJson: gltf,
          nodeColors,
        },
      ]);
      gltf = result.bakedJson;
      const newCid = await writeJSONToIPFS(gltf, null, {
        compress: true,
        assetId,
        filename:
          assetName || assetId
            ? `${assetName || assetId}_colored.gltf`
            : undefined,
      });
      const out = {
        sourceCid: newCid,
        format: "gltf",
        modified: result.modified,
        skipped: result.skipped,
      };
      if (decomposedFromGlb) out.path = "composite.gltf";
      return out;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] bakeSourceColors worker failed, falling back:",
        error.message
      );
    }
  }

  return editSourceColorsMain(sourceCid, nodeColors, options);
}

export {
  isComposite,
  estimateUploadCount,
  estimateGlbUploadCount,
  reserveFollowUpCredential,
};
