/**
 * Encoding a representation's bytes for storage and back: the brotli frame
 * parts use for text formats, raw for the rest.
 * @remarks Split from representations.ts because it pulls the codecs
 *   (`utils/compression.ts`: fflate, brotli-wasm); the list and staleness
 *   helpers stay worker-safe without them.
 */

import { compressAuto, decompressAuto, isBrotliFramed } from "../utils/compression.ts";
import { MAX_REPRESENTATION_BYTES } from "./schema.ts";
import type { Representation } from "./schema.ts";
import { encodingFor } from "./representations.ts";
import type { RepresentationEncoding } from "./representations.ts";

/**
 * Encode a file for storage: brotli-framed for text formats, raw otherwise.
 * @throws when the file exceeds {@link MAX_REPRESENTATION_BYTES}.
 */
export async function encodeRepresentation(
  bytes: Uint8Array,
  format: string,
): Promise<{ bytes: Uint8Array; encoding: RepresentationEncoding }> {
  if (bytes.byteLength > MAX_REPRESENTATION_BYTES) {
    throw new Error("A representation is at most 256 MB");
  }
  const encoding = encodingFor(format);
  if (encoding === "raw") return { bytes, encoding };
  // q5 ("binary" hint): q11 takes minutes on a long print's G-code.
  return { bytes: await compressAuto(bytes, { codec: "brotli", hint: "binary" }), encoding };
}

/**
 * Decode stored bytes back to the file, following the entry's `encoding`
 * (never sniffing a raw file, whose first bytes could look like a frame).
 * @throws when a `brotli` entry's bytes are not brotli-framed.
 */
export async function decodeRepresentation(
  bytes: Uint8Array,
  rep: Pick<Representation, "encoding">,
): Promise<Uint8Array> {
  if (rep.encoding === "raw") return bytes;
  if (!isBrotliFramed(bytes)) {
    throw new Error("Representation bytes are not brotli-framed");
  }
  return decompressAuto(bytes);
}
