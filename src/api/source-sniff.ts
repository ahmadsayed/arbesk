/**
 * Tells a JSON source (composite glTF / 3MF: lists buffer and texture CIDs)
 * from a binary one (GLB, 3MF zip: references nothing) by its first bytes.
 * @remarks Lets the IPFS GC skip downloading binary sources in full: they
 *   are most of the bytes a walk reads and hold no IPFS references. Only a
 *   positive binary match lets a caller skip; "unknown" means read in full.
 */

import zlib from "zlib";
import {
  isBrotliFramed,
  unframeBrotliPayload,
} from "@arbesk/asset-core/utils/brotli-frame.js";

export type SourceKind = "json" | "binary" | "unknown";

const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46]; // "glTF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4" (3MF)

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/** Classifies uncompressed bytes. */
function sniffPlain(bytes: Uint8Array): SourceKind {
  if (startsWith(bytes, GLB_MAGIC) || startsWith(bytes, ZIP_MAGIC)) return "binary";
  // Skip a UTF-8 BOM and whitespace before the first JSON character.
  let i = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < bytes.length && [0x20, 0x09, 0x0a, 0x0d].includes(bytes[i])) i++;
  return bytes[i] === 0x7b || bytes[i] === 0x5b ? "json" : "unknown"; // "{" or "["
}

/** Decompresses as much of a truncated stream as its bytes allow. */
function inflatePrefix(head: Uint8Array): Uint8Array | null {
  try {
    if (isBrotliFramed(head)) {
      return zlib.brotliDecompressSync(unframeBrotliPayload(head), {
        finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
      });
    }
    if (head[0] === 0x1f && head[1] === 0x8b) {
      return zlib.gunzipSync(head, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    }
  } catch {
    return new Uint8Array(0);
  }
  return null;
}

/**
 * Classifies a source file from its first bytes (a few hundred are plenty),
 * looking inside gzip and brotli-framed streams the way maybeDecompress
 * (ipfs-utils.ts) does for whole files.
 */
export function sniffSourceKind(head: Uint8Array): SourceKind {
  const inflated = inflatePrefix(head);
  return sniffPlain(inflated ?? head);
}
