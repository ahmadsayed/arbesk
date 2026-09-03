/**
 * Shared IPFS read/write helpers.
 * @remarks Consistent timeout handling.
 */

import zlib from "zlib";
import type { KuboClient } from "ipfs-http-client";

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data, "utf-8");
  return Buffer.from(data as ArrayBuffer);
}

/** Decompresses gzipped data if needed, otherwise returns as-is. */
export async function maybeDecompress(
  data: Buffer | Uint8Array | ArrayBuffer | string,
): Promise<string> {
  if (!data) return "";

  // Legacy string path: only reliable for uncompressed strings. Gzipped binary
  // that has already been UTF-8 decoded to a string cannot be decompressed
  // because the byte sequence has been replaced/re-encoded. Callers that need
  // to handle gzipped content should pass raw bytes from catBytes().
  if (typeof data === "string") {
    if (
      data.length >= 2 &&
      data.charCodeAt(0) === 0x1f &&
      data.charCodeAt(1) === 0x8b
    ) {
      try {
        const decompressed = zlib.gunzipSync(Buffer.from(data, "utf-8"));
        return decompressed.toString("utf-8");
      } catch (e) {
        console.warn("[DECOMPRESS] failed to decompress string data:", (e as Error).message);
      }
    }
    return data;
  }

  const buffer = toBuffer(data);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      const decompressed = zlib.gunzipSync(buffer);
      return decompressed.toString("utf-8");
    } catch (e) {
      console.warn("[DECOMPRESS] failed to decompress buffer:", (e as Error).message);
    }
  }
  return buffer.toString("utf-8");
}

/**
 * Reads and decodes a manifest from IPFS with a configurable timeout.
 * @throws {Error} when the CID is not found or the operation times out.
 */
export async function catManifest(
  ipfs: KuboClient,
  cid: string,
  timeoutMs = 15000,
): Promise<string> {
  console.log(`[IPFS] cat ${cid}`);
  const chunks: (Uint8Array | string)[] = [];
  for await (const chunk of ipfs.cat(cid, { timeout: timeoutMs })) {
    chunks.push(chunk);
  }

  const data = chunks
    .map((chunk) => {
      if (chunk instanceof Uint16Array) {
        return String.fromCharCode(...(chunk as Uint16Array));
      }
      if (typeof chunk === "string") return chunk;
      return new TextDecoder().decode(chunk);
    })
    .join("");

  console.log(`[IPFS] cat ${cid} → ${data.length} chars`);
  return data;
}

/**
 * Reads raw bytes from IPFS with a configurable timeout.
 * @remarks Returns a Buffer so gzip/binary content can be handled before text
 *   decoding corrupts it.
 * @throws {Error} when the CID is not found or the operation times out.
 */
export async function catBytes(
  ipfs: KuboClient,
  cid: string,
  timeoutMs = 15000,
): Promise<Buffer> {
  console.log(`[IPFS] catBytes ${cid}`);
  const chunks: Buffer[] = [];
  for await (const chunk of ipfs.cat(cid, { timeout: timeoutMs })) {
    if (chunk instanceof Uint16Array) {
      // Test-mock path: char codes that encode a UTF-8 string.
      chunks.push(Buffer.from(String.fromCharCode(...(chunk as Uint16Array)), "utf-8"));
    } else {
      chunks.push(toBuffer(chunk));
    }
  }
  const buffer = Buffer.concat(chunks);
  console.log(`[IPFS] catBytes ${cid} → ${buffer.length} bytes`);
  return buffer;
}

const IPFS_URI_RE = /ipfs:\/\/([a-zA-Z0-9]+)/g;

/**
 * Recursively extracts all `ipfs://` CIDs from a JSON value.
 */
export function extractIpfsCids(value: unknown, cids: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(IPFS_URI_RE)) {
      cids.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) extractIpfsCids(item, cids);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) extractIpfsCids(v, cids);
  }
}
