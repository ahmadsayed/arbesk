// @ts-nocheck
/**
 * Browser-safe gzip / gunzip helpers.
 *
 * Uses `fflate` (small pure-JS zlib) so it works in the browser without
 * bundler polyfills. The consumer code is responsible for deciding whether
 * to compress; reads auto-detect the gzip magic bytes and decompress.
 */

import { gzipSync, gunzipSync } from "fflate";

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);

/**
 * Convert common input types to Uint8Array.
 * @param {string|Uint8Array|ArrayBuffer} data
 * @returns {Uint8Array}
 */
function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("compression: unsupported input type");
}

/**
 * Return the input as a Uint8Array, preserving the original bytes.
 * Unlike toUint8Array, this does NOT re-encode strings.
 */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("compression: expected binary input");
}

/**
 * Check whether the first bytes look like a gzip stream.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {boolean}
 */
export function isGzipped(data) {
  const bytes = toBytes(data);
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/**
 * Gzip-compress data.
 * @param {string|Uint8Array|ArrayBuffer} data
 * @returns {Uint8Array}
 */
export function compress(data) {
  return gzipSync(toUint8Array(data), { level: 9 });
}

/**
 * Gzip-decompress data.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Uint8Array}
 */
export function decompress(data) {
  return gunzipSync(toBytes(data));
}
