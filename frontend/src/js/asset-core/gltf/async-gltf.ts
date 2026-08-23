/**
 * Async glTF Operations with Executor Offload
 *
 * These wrappers try to run heavy glTF work through the injected ExecutorPort
 * (a browser Web Worker pool in the app, the inline calling-thread executor on
 * the backend) and fall back to the main-thread implementations when the
 * executor is unavailable or fails.
 */

import { getRuntime } from "../runtime.ts";
import type { UploadCredential } from "../ipfs/upload-with-credential.ts";
import { composeGlTF } from "./composer.ts";
import {
  decomposeGlTF as decomposeGlTFMain,
  decomposeAndStore as decomposeAndStoreMain,
  isComposite,
} from "./decomposer.ts";
import { decomposeGLB as decomposeGLBMain } from "./glb-parser.ts";
import { editSourceColors as editSourceColorsMain } from "./source-color-editor.ts";

/** Upload credential as handled by this module (backend-minted, plus gateway/reusable). */
type PooledUploadCredential = UploadCredential;

/**
 * Upload credentials come from the injected CredentialPort (browser: the
 * session-backed /ipfs/upload-urls mint). An absent port means uploads are
 * not configured for this runtime.
 */
function credentialPort() {
  const c = getRuntime().credentials;
  if (!c) {
    throw new Error(
      "asset-core: upload requires a CredentialPort (createArbeskCore({ credentials }))"
    );
  }
  return c;
}

/**
 * @returns {Promise<boolean>}
 */
async function checkExecutorAvailable() {
  return getRuntime().executor.available();
}

/**
 * @param {any} name
 * @returns {string}
 */
function sanitizeAsyncName(name: any) {
  return (
    String(name || "asset")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .slice(0, 40) || "asset"
  );
}

/**
 * Upper-bound count of IPFS uploads a glTF decompose will need (buffers +
 * images + the composite JSON itself). Deliberately a loose upper bound
 * rather than mirroring decomposeGltf's exact skip logic (already-ipfs://
 * refs, external image URIs) - a few unused pooled credentials just expire
 * unused, while under-counting would starve the pool mid-upload.
 *
 * @param {any} gltfJson
 * @returns {number}
 */
function estimateUploadCount(gltfJson: any) {
  return (gltfJson?.buffers?.length || 0) + (gltfJson?.images?.length || 0) + 1;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_HEADER_LENGTH = 12;
const GLB_CHUNK_HEADER_LENGTH = 8;

/**
 * Cheaply peek a GLB's embedded JSON chunk to size the credential pool,
 * without pulling in the full gltf-transform parser on the main thread.
 * Falls back to a conservative fixed estimate if the header can't be read.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {number}
 */
function estimateGlbUploadCount(arrayBuffer: ArrayBuffer) {
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
// degrades to a smaller pool - triggering the existing executor-failure ->
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
 * @returns {Promise<PooledUploadCredential>}
 */
async function getPooledUploadCredential(count: number): Promise<PooledUploadCredential> {
  const clamped = Math.min(Math.max(count, 1), MAX_POOLED_CREDENTIALS);
  const credentials = await credentialPort().getUploadCredentials(clamped);
  const first = credentials[0];
  if (!first) {
    throw new Error("getPooledUploadCredential: no credentials returned");
  }
  if (first.backend !== "pinata") return first;
  return {
    backend: "pinata",
    gateway: first.gateway,
    urls: credentials.map((c) => (c.url as string)),
    reusable: true,
  };
}

/**
 * Carve one URL off a pooled Pinata credential for a follow-up upload that
 * happens on the main thread AFTER an executor call that also draws from the
 * pool.
 *
 * Necessary when the executor is worker-backed: `workerPool.exec()` passes the
 * credential through structured clone, so the worker mutates its OWN copy of
 * `credential.urls` as it uploads and the main thread's copy is never touched.
 * Without this, a post-executor upload (e.g. the composite JSON) would pop
 * url[0] from the still-full main-thread copy - a URL the worker already spent
 * inside its clone - and get HTTP 409 "duplicate file id" from Pinata.
 *
 * Reserving one URL up front sidesteps the clone desync entirely: the worker
 * gets a pool one shorter, the main thread gets a single dedicated URL, and
 * neither can collide with the other.
 *
 * No-op for kubo (or an already single-shot credential) since there's no
 * clone-desync risk to guard against.
 *
 * @param {PooledUploadCredential} credential
 * @returns {{workerCredential: PooledUploadCredential, followUpCredential: PooledUploadCredential}}
 */
function reserveFollowUpCredential(credential: PooledUploadCredential) {
  if (credential?.backend === "pinata" && credential.urls && credential.urls.length > 1) {
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
 * Compose a composite glTF into a renderable glTF with data URIs.
 * Tries the executor first; falls back to the main-thread composer.
 *
 * @param {any} compositeJson
 * @returns {Promise<any>} composed glTF JSON
 */
export async function composeGlTFAsync(compositeJson: any) {
  if (!compositeJson) throw new Error("composeGlTFAsync: gltfJson is null");

  if (await checkExecutorAvailable()) {
    try {
      const { composedJson } = await getRuntime().executor.exec("compose", [
        { compositeJson },
      ]);
      return composedJson;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] compose executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  return composeGlTF(compositeJson);
}

/**
 * Compose a composite glTF into a renderable Blob of glTF JSON.
 *
 * Worker-executor path: the worker composes, stringifies, and encodes the
 * glTF, then transfers the bytes zero-copy — the main thread never holds the
 * composed JSON object or pays a giant JSON.stringify. Fallback matches the
 * previous behavior: main-thread composeGlTF() + JSON.stringify wrapped in a
 * Blob.
 *
 * @param {any} compositeJson
 * @returns {Promise<Blob>} application/json Blob ready for a blob URL
 */
export async function composeGlTFToBlobAsync(compositeJson: any) {
  if (!compositeJson) {
    throw new Error("composeGlTFToBlobAsync: gltfJson is null");
  }

  if (await checkExecutorAvailable()) {
    try {
      const { composedBytes } = await getRuntime().executor.exec(
        "composeToBytes",
        [{ compositeJson }]
      );
      return new Blob([composedBytes], { type: "application/json" });
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] composeToBytes executor failed, falling back:",
        (error as Error).message
      );
    }
  }

  const composed = await composeGlTF(compositeJson);
  return new Blob([JSON.stringify(composed)], { type: "application/json" });
}

/**
 * Decompose a standard glTF JSON into a composite + extracted buffers/images.
 * The worker path does NOT upload to IPFS; caller must upload returned bytes
 * and rewrite URIs, or use decomposeAndStoreAsync. (The main-thread fallback
 * decomposer always uploads as it extracts, so it returns empty
 * buffers/images lists.)
 *
 * @param {any} gltfJson
 * @returns {Promise<{composite: any, buffers: any[], images: any[]}>}
 */
export async function decomposeGlTFAsync(gltfJson: any) {
  if (!gltfJson) throw new Error("decomposeGlTFAsync: gltf is null");

  if (await checkExecutorAvailable()) {
    try {
      return await getRuntime().executor.exec("decomposeGltf", [{ gltfJson }]);
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] decomposeGltf executor failed, falling back:",
        (error as Error).message
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
 * @param {any} gltfJson
 * @param {object} [options]
 * @param {string} [options.assetName]
 * @param {string} [options.assetId]
 * @param {Map<string, string>|null} [options.dedupMap]
 * @returns {Promise<{composite: any, compositeCid: string}>}
 */
export async function decomposeAndStoreAsync(
  gltfJson: any,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null } = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  const credential = await getPooledUploadCredential(
    estimateUploadCount(gltfJson)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkExecutorAvailable())) {
    try {
      // Executor path: extraction + batched IPFS upload happen off the main
      // thread when the executor is worker-backed. Workers store components
      // uncompressed (no fflate in the worker); the inline executor compresses
      // like the main-thread path. The composite JSON is written back on the
      // main thread afterward, so its credential is reserved up front (see
      // reserveFollowUpCredential) rather than shared with the worker's clone
      // of the pool.
      const { workerCredential, followUpCredential } =
        reserveFollowUpCredential(reusableCredential);
      const { composite } = await getRuntime().executor.exec(
        "decomposeAndUploadGltf",
        [{ gltfJson, credential: workerCredential, options: { dedupMap } }]
      );
      const compositeCid = await getRuntime().ipfsWrite.writeJSON(
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
        "[ASYNC-GLTF] decomposeAndUploadGltf executor failed, falling back:",
        (error as Error).message
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
 * @param {Map<string, string>|null} [options.dedupMap]
 * @returns {Promise<{composite: any, compositeCid: string|null}>}
 */
export async function decomposeGLBAsync(
  arrayBuffer: ArrayBuffer,
  storeComposite = true,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null } = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!arrayBuffer)
    throw new Error("decomposeGLBAsync: arrayBuffer is required");

  const credential = await getPooledUploadCredential(
    estimateGlbUploadCount(arrayBuffer)
  );
  const reusableCredential = credential?.reusable ? credential : null;

  if (reusableCredential && (await checkExecutorAvailable())) {
    try {
      // Executor path: extraction + batched IPFS upload happen off the main
      // thread when the executor is worker-backed.
      const { composite, compositeCid } = await getRuntime().executor.exec(
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
        "[ASYNC-GLTF] decomposeAndUploadGlb executor failed, falling back:",
        (error as Error).message
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
 * Mirrors editSourceColors but offloads the color baking to the executor.
 *
 * @param {string} sourceCid
 * @param {Object<string, string>} nodeColors
 * @param {object} [options] - Optional parameters
 * @param {string} [options.assetName] - Asset name for IPFS filename
 * @param {string} [options.assetId] - Asset ID for IPFS filename
 * @param {Map<string, string>|null} [options.dedupMap]
 * @returns {Promise<{sourceCid: string, format?: string, path?: string, modified: number, skipped: number}>}
 */
export async function editSourceColorsAsync(
  sourceCid: string,
  nodeColors: any,
  options: { assetName?: string; assetId?: string; dedupMap?: Map<string, string> | null } = {}
) {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid)
    throw new Error("editSourceColorsAsync: sourceCid is required");
  if (!nodeColors || Object.keys(nodeColors).length === 0) {
    return { sourceCid, modified: 0, skipped: 0 };
  }

  let gltf: any = null;
  let decomposedFromGlb = false;

  try {
    const buffer = await getRuntime().ipfsRead.getBytes(sourceCid);
    if (getRuntime().kernels.glb.isGLB(buffer)) {
      const { composite } = await decomposeGLBAsync(buffer, false, {
        dedupMap,
      });
      gltf = composite;
      decomposedFromGlb = true;
    } else {
      gltf = JSON.parse(new TextDecoder().decode(buffer));
    }
  } catch (err) {
    console.warn(
      `[ASYNC-GLTF] failed to fetch ${sourceCid}: ${(err as Error).message}`
    );
    throw err;
  }

  if (await checkExecutorAvailable()) {
    try {
      const result = await getRuntime().executor.exec("bakeSourceColors", [
        {
          gltfJson: gltf,
          nodeColors,
        },
      ]);
      gltf = result.bakedJson;
      const newCid = await getRuntime().ipfsWrite.writeJSON(gltf, null, {
        compress: true,
        assetId,
        filename:
          assetName || assetId
            ? `${assetName || assetId}_colored.gltf`
            : undefined,
      });
      const out: {
        sourceCid: string;
        format: string;
        path?: string;
        modified: number;
        skipped: number;
      } = {
        sourceCid: newCid,
        format: "gltf",
        modified: result.modified,
        skipped: result.skipped,
      };
      if (decomposedFromGlb) out.path = "composite.gltf";
      return out;
    } catch (error) {
      console.warn(
        "[ASYNC-GLTF] bakeSourceColors executor failed, falling back:",
        (error as Error).message
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
