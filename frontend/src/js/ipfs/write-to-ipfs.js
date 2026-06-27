// @ts-nocheck
/**
 * Arbesk Browser-Side IPFS Writer
 *
 * Fetches a short-lived upload credential from the backend, then uploads
 * directly to the chosen storage backend:
 *   - pinata: POST the file to a presigned URL (CIDv1 returned)
 *   - kubo:   POST multipart to the local Kubo node (E2E/dev fallback)
 */
import { getUploadCredential } from "../services/api.js";
import { compress } from "../utils/compression.js";
import { sanitizeFileName } from "../utils/uri.js";

// write-to-ipfs.js is imported by both the main thread and the glTF Web Worker.
// Use a distinct tag in worker context so uploads originating off-thread are
// easy to spot in the console.
const IS_WORKER =
  typeof WorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof WorkerGlobalScope;
const TAG = IS_WORKER ? "[WORKER-IPFS-WRITE]" : "[IPFS-WRITE]";

// Caches are intentionally disabled. Validation must depend on the manifest
// itself always being unique (timestamp + version), not on memoization.

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function toBlob(data) {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array)
    return new Blob([data]);
  if (typeof data === "string")
    return new Blob([data], { type: "application/octet-stream" });
  throw new Error("writeToIPFS: unsupported data type");
}

function compressedFilename(filename) {
  if (!filename) return "asset.bin.gz";
  return filename.endsWith(".gz") ? filename : `${filename}.gz`;
}

async function uploadToPinata(blob, filename, credential, attempt = 1) {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("network", "public");

  try {
    const res = await fetch(credential.url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinata upload failed: ${res.status} - ${text}`);
    }
    const json = await res.json();
    const cid = json?.data?.cid || json?.cid;
    if (!cid) throw new Error("Pinata upload returned no CID");
    console.log(`${TAG} pinata stored → ${cid}`);
    return cid;
  } catch (err) {
    // Retry once on transient network / HTTP2 protocol errors.
    if (attempt === 1 && /HTTP2|fetch|network|aborted/i.test(err.message)) {
      console.warn(`${TAG} Pinata upload error, retrying once: ${err.message}`);
      return uploadToPinata(blob, filename, credential, attempt + 1);
    }
    throw err;
  }
}

async function uploadToKubo(blob, filename, credential) {
  const apiUrl = credential.apiUrl || "http://127.0.0.1:5001";
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(`${apiUrl}/api/v0/add?cid-version=1`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`IPFS add failed: ${res.status} - ${text}`);
  }
  const result = await res.json();
  console.log(`${TAG} kubo stored → ${result.Hash} (${result.Size} bytes)`);
  try {
    await fetch(
      `${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(result.Hash)}`,
      { method: "POST" }
    );
    console.log(`${TAG} pinned → ${result.Hash}`);
  } catch (e) {
    console.warn(`${TAG} pin failed (non-fatal): ${e.message}`);
  }
  return result.Hash;
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
  let payload = data;
  if (options.compress) {
    payload = compress(data);
    console.log(
      `${TAG} gzip ${
        typeof data === "string" ? data.length : data.byteLength ?? data.length
      } bytes → ${payload.length} bytes`
    );
  }
  const finalFilename = options.compress
    ? compressedFilename(filename)
    : filename;
  const blob = toBlob(payload);
  const bytes = await blobToBytes(blob);

  const cred = credential || (await getUploadCredential());
  console.log(
    `${TAG} uploading ${bytes.length} bytes via ${cred.backend} as ${finalFilename}`
  );
  const cid =
    cred.backend === "pinata"
      ? await uploadToPinata(blob, finalFilename, cred)
      : await uploadToKubo(blob, finalFilename, cred);

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
