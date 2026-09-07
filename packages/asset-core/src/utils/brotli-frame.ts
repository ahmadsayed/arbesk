/**
 * Self-describing frame for brotli payloads.
 * @remarks Brotli streams carry no magic bytes of their own, so compressed
 *   payloads are framed with {@link BROTLI_MAGIC} ("ARB\x01") and reads sniff
 *   it — same strategy as the gzip magic. This module is intentionally
 *   dependency-free (no fflate, no brotli-wasm) so the glTF worker and the
 *   besk CLI can import it without dragging a codec into their bundles.
 */

/** Frame prepended to brotli payloads ("ARB\x01"). */
export const BROTLI_MAGIC = new Uint8Array([0x41, 0x52, 0x42, 0x01]);

/**
 * Check whether the payload carries the brotli frame magic.
 */
export function isBrotliFramed(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return (
    bytes.length >= BROTLI_MAGIC.length &&
    BROTLI_MAGIC.every((b, i) => bytes[i] === b)
  );
}

/**
 * Prepend the brotli frame magic to a compressed brotli stream.
 */
export function frameBrotliPayload(packed: Uint8Array): Uint8Array {
  const framed = new Uint8Array(BROTLI_MAGIC.length + packed.length);
  framed.set(BROTLI_MAGIC, 0);
  framed.set(packed, BROTLI_MAGIC.length);
  return framed;
}

/**
 * Strip the frame magic from a framed payload (callers check
 * {@link isBrotliFramed} first).
 */
export function unframeBrotliPayload(framed: Uint8Array): Uint8Array {
  return framed.subarray(BROTLI_MAGIC.length);
}
