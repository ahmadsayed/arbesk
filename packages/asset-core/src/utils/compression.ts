/**
 * Browser-safe gzip / gunzip / brotli helpers.
 * @remarks Reads auto-detect the payload encoding: the gzip magic bytes, the
 *   self-describing {@link BROTLI_MAGIC} frame (brotli streams carry no magic
 *   of their own), or raw passthrough. The caller decides whether and how to
 *   compress; brotli is the default codec for new writes.
 */

import { gzipSync, gunzipSync } from "fflate";
import type { BrotliWasmType } from "brotli-wasm";
import {
  BROTLI_MAGIC,
  isBrotliFramed,
  frameBrotliPayload,
  unframeBrotliPayload,
} from "./brotli-frame.ts";

export { BROTLI_MAGIC, isBrotliFramed };

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);

export type CompressionCodec = "gzip" | "brotli";

/** Content hint driving the brotli quality level: text/JSON gets q11, binary q5. */
export type CompressHint = "json" | "binary";

let brotliInstance: Promise<BrotliWasmType> | null = null;

/**
 * Lazily instantiate the brotli-wasm module (one WASM compile per process).
 * @remarks Runtime split: plain Node (jest) uses the package's synchronous
 *   CJS build via createRequire — its ESM web build fetches the .wasm over
 *   file://, which Node's fetch rejects. Bun (dev backend, compiled binary —
 *   the latter via
 *   the embedding shim in scripts/build-server.mjs) and the browser bundles
 *   use the ESM entry, whose default export is a promise of the API.
 */
function loadBrotli(): Promise<BrotliWasmType> {
  if (!brotliInstance) {
    const isPlainNode =
      typeof process !== "undefined" &&
      !!process.versions?.node &&
      !process.versions?.bun;
    brotliInstance = isPlainNode
      ? import("node:module").then(
          ({ createRequire }) =>
            createRequire(import.meta.url)("brotli-wasm") as BrotliWasmType
        )
      : import("brotli-wasm").then((mod) => {
          const withDefault = mod as { default?: Promise<BrotliWasmType> | BrotliWasmType };
          return (withDefault.default ?? mod) as BrotliWasmType | Promise<BrotliWasmType>;
        });
  }
  return brotliInstance;
}

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
 * Coerce any port-write input (including Blob) to bytes. Shared by the IPFS
 * write-port adapters so they all accept the same data shapes.
 */
export async function bytesFromData(
  data: string | Uint8Array | ArrayBuffer | Blob
): Promise<Uint8Array> {
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return toUint8Array(data as string | Uint8Array | ArrayBuffer);
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
 * Check whether a stored payload is compressed at all (brotli frame or gzip).
 */
export function isCompressedPayload(data: Uint8Array | ArrayBuffer): boolean {
  return isBrotliFramed(data) || isGzipped(data);
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

/**
 * Wrap a brotli-wasm call, normalizing its non-Error throws (wasm-bindgen heap
 * objects) into real Errors so downstream `catch` handling stays sane.
 */
function brotliCall<T>(fn: (api: BrotliWasmType) => T, api: BrotliWasmType): T {
  try {
    return fn(api);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Compress data with the given codec (default brotli, framed with
 * {@link BROTLI_MAGIC}). `hint: "json"` selects brotli q11 for text/manifest
 * content; anything else gets q5 to keep large binary buffers fast.
 */
export async function compressAuto(
  data: string | Uint8Array | ArrayBuffer,
  options: { codec?: CompressionCodec; hint?: CompressHint } = {}
): Promise<Uint8Array> {
  const codec = options.codec ?? "brotli";
  if (codec === "gzip") return compress(data);
  const brotli = await loadBrotli();
  const quality = options.hint === "json" ? 11 : 5;
  const packed = brotliCall((api) => api.compress(toUint8Array(data), { quality }), brotli);
  return frameBrotliPayload(packed);
}

/**
 * Decompress a payload, auto-detecting the codec from the bytes: brotli frame
 * → brotli, gzip magic → gunzip, anything else passes through unchanged.
 */
export async function decompressAuto(data: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const bytes = toBytes(data);
  if (isBrotliFramed(bytes)) {
    const brotli = await loadBrotli();
    return brotliCall((api) => api.decompress(unframeBrotliPayload(bytes)), brotli);
  }
  if (isGzipped(bytes)) return decompress(bytes);
  return bytes;
}
