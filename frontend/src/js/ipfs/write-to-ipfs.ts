/**
 * Browser-side IPFS writer: fetches a short-lived upload credential from the
 * backend, then uploads directly to the chosen storage backend.
 */

import { getUploadCredential } from "../services/backend-client.ts";
import { compress } from "@arbesk/asset-core/utils/compression.js";
import { sanitizeFileName } from "@arbesk/asset-core/utils/uri.js";
import { uploadToIPFSWithCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";

async function bytesFromData(
  data: Uint8Array | ArrayBuffer | Blob | string
): Promise<Uint8Array> {
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

function ts(): string {
  return new Date().toLocaleTimeString();
}

function compressedFilename(filename: string): string {
  if (!filename) return "asset.bin.gz";
  return filename.endsWith(".gz") ? filename : `${filename}.gz`;
}

/**
 * Writes raw binary/string data to IPFS and returns its CID.
 * @remarks Reused credentials must be marked `reusable` by the backend.
 */
export async function writeToIPFS(
  data: Uint8Array | ArrayBuffer | Blob | string,
  filename: string = "asset.bin",
  credential: UploadCredential | null = null,
  options: { compress?: boolean } = {}
): Promise<string> {
  const cred = credential || (await getUploadCredential());

  let payload: Uint8Array | ArrayBuffer | Blob | string = data;
  let finalFilename = filename;
  if (options.compress) {
    const raw = await bytesFromData(data);
    payload = compress(raw);
    finalFilename = compressedFilename(filename);
    console.log(
      `[${ts()}] ${TAG} gzip ${raw.length} bytes → ${payload.length} bytes`
    );
  }

  const rawPayload = payload as any;
  const byteLength =
    payload instanceof Blob
      ? payload.size
      : rawPayload?.byteLength ?? rawPayload?.length ?? 0;

  console.log(
    `[${ts()}] ${TAG} uploading ${byteLength} bytes via ${cred.strategy} as ${finalFilename}`
  );

  const cid = await uploadToIPFSWithCredential(
    payload,
    finalFilename,
    cred
  );

  console.log(`[${ts()}] ${TAG} ${cred.strategy} stored → ${cid}`);
  return cid;
}

/**
 * Writes JSON data to IPFS and returns its CID.
 */
export async function writeJSONToIPFS(
  json: Record<string, any>,
  credential: UploadCredential | null = null,
  options: {
    /** Gzip-compress before uploading. */
    compress?: boolean;
    /** "collection" or anything else; drives default filename. */
    type?: string;
    /** Used to build the default filename. */
    assetId?: string;
    /** Override the default filename. */
    filename?: string;
  } = {}
): Promise<string> {
  const { type, assetId, filename, compress } = options;
  let baseName;
  if (filename) {
    baseName = filename;
  } else if (type === "collection") {
    baseName = `collect_${sanitizeFileName(
      assetId || json.asset_id || Date.now()
    )}.json`;
  } else if (type === "editors") {
    baseName = `editors_${sanitizeFileName(String(assetId || Date.now()))}.json`;
  } else {
    baseName = `asset_${sanitizeFileName(
      assetId || json.asset_id || "composite"
    )}_composite.gltf`;
  }
  return writeToIPFS(JSON.stringify(json), baseName, credential, { compress });
}
