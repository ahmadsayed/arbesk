/**
 * Browser-safe gzip / gunzip helpers.
 * @remarks Reads auto-detect the gzip magic bytes and decompress; the caller
 *   decides whether to compress.
 */

import { gzipSync, gunzipSync } from "fflate";

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);

/**
 * Convert common input types to Uint8Array.
 */
function toUint8Array(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("compression: unsupported input type");
}

/**
 * Returns the input as a Uint8Array, preserving the original bytes.
 * @remarks Does not re-encode strings (binary input only).
 */
function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("compression: expected binary input");
}

/**
 * Check whether the first bytes look like a gzip stream.
 */
export function isGzipped(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = toBytes(data);
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/**
 * Gzip-compress data.
 */
export function compress(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  return gzipSync(toUint8Array(data), { level: 9 });
}

/**
 * Gzip-decompress data.
 */
export function decompress(data: Uint8Array | ArrayBuffer): Uint8Array {
  return gunzipSync(toBytes(data));
}
