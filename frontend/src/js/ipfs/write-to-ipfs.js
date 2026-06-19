/**
 * Arbesk Browser-Side IPFS Writer
 *
 * Fetches a short-lived upload credential from the backend, then uploads
 * directly to the chosen storage backend:
 *   - pinata: POST the file to a presigned URL (CIDv1 returned)
 *   - kubo:   POST multipart to the local Kubo node (E2E/dev fallback)
 */
import { getUploadCredential } from "../services/api.js";

function toBlob(data) {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array) return new Blob([data]);
  if (typeof data === "string") return new Blob([data], { type: "application/octet-stream" });
  throw new Error("writeToIPFS: unsupported data type");
}

async function uploadToPinata(blob, filename, credential) {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("network", "public");
  const res = await fetch(credential.url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed: ${res.status} — ${text}`);
  }
  const json = await res.json();
  const cid = json?.data?.cid || json?.cid;
  if (!cid) throw new Error("Pinata upload returned no CID");
  console.log(`[IPFS-WRITE] pinata stored → ${cid}`);
  return cid;
}

async function uploadToKubo(blob, filename, credential) {
  const apiUrl = credential.apiUrl || "http://127.0.0.1:5001";
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(`${apiUrl}/api/v0/add`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`IPFS add failed: ${res.status} — ${text}`);
  }
  const result = await res.json();
  console.log(`[IPFS-WRITE] kubo stored → ${result.Hash} (${result.Size} bytes)`);
  try {
    await fetch(`${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(result.Hash)}`, { method: "POST" });
    console.log(`[IPFS-WRITE] pinned → ${result.Hash}`);
  } catch (e) {
    console.warn(`[IPFS-WRITE] pin failed (non-fatal): ${e.message}`);
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
 * @returns {Promise<string>}
 */
export async function writeToIPFS(data, filename = "asset.bin", credential = null) {
  const blob = toBlob(data);
  const cred = credential || (await getUploadCredential());
  console.log(`[IPFS-WRITE] uploading ${blob.size} bytes via ${cred.backend}`);
  return cred.backend === "pinata"
    ? uploadToPinata(blob, filename, cred)
    : uploadToKubo(blob, filename, cred);
}

/**
 * Write JSON data to IPFS and return its CID.
 * @param {object} json
 * @param {object} [credential=null] - Optional reusable upload credential.
 * @returns {Promise<string>}
 */
export async function writeJSONToIPFS(json, credential = null) {
  return writeToIPFS(JSON.stringify(json, null, 2), "composite.gltf", credential);
}
