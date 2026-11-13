/**
 * Packs every data-URI buffer into one BIN chunk and points the glTF at it.
 * @remarks A GLB has a single embedded buffer, so the buffers collapse to one
 *   entry and each bufferView is rebased onto it. Parts are padded to 4 bytes
 *   so accessors stay aligned after concatenation.
 */
export function packComposedBuffers(composed: any): Buffer {
  const binParts: Buffer[] = [];
  const bufOffsets: number[] = [];
  let cumulative = 0;
  for (const buf of composed.buffers || []) {
    bufOffsets.push(cumulative);
    const bytes = buf.uri && buf.uri.startsWith("data:")
      ? Buffer.from(buf.uri.split(",")[1], "base64")
      : Buffer.alloc(buf.byteLength || 0);
    const padding = (4 - (bytes.length % 4)) % 4;
    binParts.push(bytes, Buffer.alloc(padding));
    cumulative += bytes.length + padding;
  }

  for (const bv of composed.bufferViews || []) {
    if (bv.buffer >= 0 && bv.buffer < bufOffsets.length) {
      bv.byteOffset = (bv.byteOffset || 0) + bufOffsets[bv.buffer];
      bv.buffer = 0;
    }
  }
  if (composed.buffers?.length) composed.buffers = [{ byteLength: cumulative }];

  return Buffer.concat(binParts);
}
