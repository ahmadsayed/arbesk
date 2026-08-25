/**
 * Worker-safe IPFS upload primitives.
 *
 * Unlike write-to-ipfs.js, this module does NOT fetch upload credentials or
 * touch session storage, so it can run inside a Web Worker. Callers must
 * supply a credential obtained from the main thread (e.g. via
 * getUploadCredential()).
 */

import { createConcurrencyLimiter } from "../../utils/concurrency.ts";

// Keep concurrent uploads bounded near the browser's per-origin connection
// limit so many small buffers/images don't queue/retire behind each other.
const UPLOAD_CONCURRENCY = 6;
const uploadLimiter = createConcurrencyLimiter(UPLOAD_CONCURRENCY);

/**
 * Upload credential minted by the backend (`getUploadCredential()` /
 * `getUploadCredentials()` in services/api.js).
 */
export interface UploadCredential {
  /** Upload topology the client should use — presigned URL or a Kubo RPC.
   *  (extensible to "server-proxy" and "helia" without touching the SDK). */
  strategy: "presigned-put" | "kubo-api";
  /** Presigned URL (single-use). Pinata today; Storj later. */
  url?: string;
  /** Pooled presigned URLs, one per file (single-use backends). */
  urls?: string[];
  /** Object key (= CID) carried for presigned backends whose response does
   *  not echo a CID (Storj). Unused by Pinata, whose response returns the CID. */
  key?: string;
  /** Kubo API base URL (kubo-api strategy). */
  apiUrl?: string;
  /** Gateway base URL returned alongside the credential. */
  gateway?: string;
  /** Whether one credential can be reused for a whole batch (kubo-api). */
  reusable?: boolean;
}

function ts(): string {
  return new Date().toLocaleTimeString();
}

function toBlob(data: Uint8Array | ArrayBuffer | Blob | string): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer || data instanceof Uint8Array)
    // `as any`: the BlobPart union name differs between the DOM lib and
    // @types/node; both accept Uint8Array/ArrayBuffer at runtime.
    return new Blob([data as any]);
  if (typeof data === "string")
    return new Blob([data], { type: "application/octet-stream" });
  throw new Error("uploadWithCredential: unsupported data type");
}

/**
 * Pinata signed URLs are single-use (a second upload against the same URL
 * gets HTTP 409 "duplicate file id" - verified empirically). Batch callers
 * pass a pooled credential (`credential.urls`, one per file); single-shot
 * callers still pass a plain `credential.url`. Popping mutates the pool
 * in place, which is safe here because JS is single-threaded and each pop
 * happens synchronously before the upload's first `await`.
 */
function nextPresignedUrl(credential: UploadCredential): string {
  if (credential.urls) {
    const url = credential.urls.shift();
    if (!url) {
      throw new Error("uploadToPresignedPut: credential pool exhausted");
    }
    return url;
  }
  return credential.url as string;
}

async function uploadToPresignedPut(
  blob: Blob,
  filename: string,
  credential: UploadCredential,
  attempt: number = 1
): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("network", "public");
  const start = performance.now();
  const url = nextPresignedUrl(credential);

  try {
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Presigned upload failed: ${res.status} - ${text}`);
    }
    const json = (await res.json()) as any;
    const cid = json?.data?.cid || json?.cid || credential.key;
    if (!cid) throw new Error("Presigned upload returned no CID");
    console.log(
      `[${ts()}] [UPLOAD] presigned stored → ${cid} ` +
        `(${Math.round(performance.now() - start)}ms)`
    );
    return cid;
  } catch (err) {
    const error = err as Error;
    // Retrying against the SAME url would be wrong when the pool has moved on
    // (that url may have already stored the file, turning the retry into a
    // guaranteed 409). Only retry with a pool url on hand; a single-shot
    // credential has no replacement, so it retries the same url as before.
    if (attempt === 1 && /HTTP2|fetch|network|aborted/i.test(error.message)) {
      console.warn(
        `[${ts()}] [UPLOAD] presigned upload error after ` +
          `${Math.round(performance.now() - start)}ms, retrying once: ${error.message}`
      );
      return uploadToPresignedPut(blob, filename, credential, attempt + 1);
    }
    throw error;
  }
}

async function uploadToKuboApi(
  blob: Blob,
  filename: string,
  credential: UploadCredential
): Promise<string> {
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
  const result = (await res.json()) as any;
  const cidStr = result.Hash;
  console.log(`[${ts()}] [UPLOAD] kubo stored → ${cidStr} (${result.Size} bytes)`);
  try {
    await fetch(
      `${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(cidStr)}`,
      { method: "POST" }
    );
    console.log(`[${ts()}] [UPLOAD] pinned → ${cidStr}`);
  } catch {
    // Pin failures are non-fatal; the CID is still stored.
  }
  return cidStr;
}

/**
 * Upload raw/string/blob data to IPFS using the provided credential.
 *
 * The caller is responsible for compression (e.g. appending `.gz` and passing
 * pre-compressed bytes). Keeping compression out of this module lets it run
 * safely inside a Web Worker without pulling in the fflate dependency.
 *
 * @param credential - Upload credential (a self-describing strategy token:
 *   `presigned-put` presigned URL or `kubo-api` API URL).
 * @returns CID
 */
export async function uploadToIPFSWithCredential(
  data: Uint8Array | ArrayBuffer | Blob | string,
  filename: string,
  credential: UploadCredential
): Promise<string> {
  const blob = toBlob(data);

  return uploadLimiter.run(async () => {
    const cid =
      credential.strategy === "presigned-put"
        ? await uploadToPresignedPut(blob, filename, credential)
        : await uploadToKuboApi(blob, filename, credential);
    return cid;
  });
}

/**
 * Upload multiple files in one batch when the strategy supports it.
 *
 * `kubo-api` supports true multi-file `add` via multipart. `presigned-put`
 * URLs are strictly single-use, so this instead uploads concurrently with one
 * pooled url per file (`credential.urls`, minted via `getUploadCredentials()`)
 * - bounded by the per-credential limiter. Callers must pre-compress data and
 * use `.gz` filenames if they want compression. Returns a map of
 * filename -> CID.
 *
 * @returns filename -> CID
 */
export async function uploadBatchToIPFSWithCredential(
  files: Array<{ name: string; data: Uint8Array | string }>,
  credential: UploadCredential
): Promise<Map<string, string>> {
  if (!files || files.length === 0) {
    return new Map();
  }

  if (credential.strategy === "kubo-api") {
    return uploadBatchToKuboApi(files, credential);
  }

  const results = new Map<string, string>();
  await Promise.all(
    files.map(async ({ name, data }) => {
      const cid = await uploadToIPFSWithCredential(data, name, credential);
      results.set(name, cid);
    })
  );
  return results;
}

/**
 * Kubo-specific multipart batch upload.
 *
 * Sends all files in one multipart POST and parses the newline-delimited JSON
 * responses. Each response line contains { Name, Hash, Size } for one file.
 */
async function uploadBatchToKuboApi(
  files: Array<{ name: string; data: Uint8Array | string }>,
  credential: UploadCredential
): Promise<Map<string, string>> {
  const apiUrl = credential.apiUrl || "http://127.0.0.1:5001";
  const form = new FormData();
  for (const { name, data } of files) {
    form.append("file", toBlob(data), name);
  }

  return uploadLimiter.run(async () => {
    const res = await fetch(
      `${apiUrl}/api/v0/add?cid-version=1&wrap-with-directory=false`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Kubo batch add failed: ${res.status} - ${text}`);
    }

    const text = await res.text();
    const results = new Map<string, string>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.Name && obj.Hash) {
          results.set(obj.Name, obj.Hash);
        }
      } catch {
        // Ignore malformed trailing lines.
      }
    }

    // Pin each returned CID. Fire-and-forget; pinning failures are non-fatal.
    for (const cid of results.values()) {
      Promise.resolve(
        fetch(`${apiUrl}/api/v0/pin/add?arg=${encodeURIComponent(cid)}`, {
          method: "POST",
        })
      ).catch(() => {});
    }

    return results;
  });
}
