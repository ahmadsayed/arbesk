// @ts-nocheck
/**
 * Arbesk Browser-Side IPFS Writer
 *
 * Fetches a short-lived upload credential from the backend, then uploads
 * directly to the chosen storage backend using the worker-safe primitives in
 * upload-with-credential.js.
 */

import { getUploadCredential } from "../services/api.js";
import { compress } from "../utils/compression.js";
import { sanitizeFileName } from "../utils/uri.js";
import { uploadToIPFSWithCredential } from "./upload-with-credential.js";

async function bytesFromData(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("writeToIPFS: unsupported data type");
}

// write-to-ipfs.js is imported by both the main thread and the glTF Web Worker.
// Use a distinct tag in worker context so uploads originating off-thread are
// easy to spot in the console.
const IS_WORKER =
  typeof WorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof WorkerGlobalScope;
const TAG = IS_WORKER ? "[WORKER-IPFS-WRITE]" : "[IPFS-WRITE]";

function compressedFilename(filename) {
  if (!filename) return "asset.bin.gz";
  return filename.endsWith(".gz") ? filename : `${filename}.gz`;
}

/**
 * Write raw binary/string data to IPFS and return its CID.
 * @param {Uint8Array|ArrayBuffer|Blob|string} data
 * @param {string} [filename="asset.bin"]
 * @param {object} [credential=null] - Optional upload credential. When omitted,
 *   a fresh credential is fetched. Callers reusing a credential must ensure it
 *   is marked `reusable` by the backend.
 * @param {object} [options={}] - Optional write options.
 * @param {boolean} [options.compress=false] - Gzip-compress before uploading.
 * @returns {Promise<string>}
 */
export async function writeToIPFS(
  data,
  filename = "asset.bin",
  credential = null,
  options = {}
) {
  const cred = credential || (await getUploadCredential());

  let payload = data;
  let finalFilename = filename;
  if (options.compress) {
    const raw = await bytesFromData(data);
    payload = compress(raw);
    finalFilename = compressedFilename(filename);
    console.log(
      `${TAG} gzip ${raw.length} bytes → ${payload.length} bytes`
    );
  }

  const byteLength =
    payload instanceof Blob
      ? payload.size
      : payload?.byteLength ?? payload?.length ?? 0;

  console.log(
    `${TAG} uploading ${byteLength} bytes via ${cred.backend} as ${finalFilename}`
  );

  const cid = await uploadToIPFSWithCredential(
    payload,
    finalFilename,
    cred
  );

  console.log(`${TAG} ${cred.backend} stored → ${cid}`);
  return cid;
}

/**
 * Write JSON data to IPFS and return its CID.
 * @param {object} json
 * @param {object} [credential=null] - Optional reusable upload credential.
 * @param {object} [options={}] - Optional write options.
 * @param {boolean} [options.compress=false] - Gzip-compress before uploading.
 * @param {string} [options.type] - "collection" or anything else; drives default filename.
 * @param {string} [options.assetId] - Used to build the default filename.
 * @param {string} [options.filename] - Override the default filename.
 * @returns {Promise<string>}
 */
export async function writeJSONToIPFS(json, credential = null, options = {}) {
  const { type, assetId, filename, compress } = options;
  let baseName;
  if (filename) {
    baseName = filename;
  } else if (type === "collection") {
    baseName = `collect_${sanitizeFileName(
      assetId || json.asset_id || Date.now()
    )}.json`;
  } else if (type === "editors") {
    baseName = `editors_${sanitizeFileName(assetId || Date.now())}.json`;
  } else {
    baseName = `asset_${sanitizeFileName(
      assetId || json.asset_id || "composite"
    )}_composite.gltf`;
  }
  return writeToIPFS(JSON.stringify(json), baseName, credential, { compress });
}
