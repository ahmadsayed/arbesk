/**
 * Image MIME sniffing for the glTF pipeline.
 * @remarks KTX2 keeps Basis-compressed glTF textures working — generic
 *   sniffers don't cover it, which is why this signature table exists
 *   instead of a library.
 * Used by the GLB parser and the glTF Web Worker.
 */

const IMAGE_SIGNATURES: Array<{ mime: string; magic: number[] }> = [
  { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  // WebP: "RIFF" <4-byte size> "WEBP"
  { mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x57, 0x45, 0x42, 0x50] },
  // KTX2: "\xABKTX 11\xBB\r\n\x1A\n"
  { mime: "image/ktx2", magic: [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", magic: [0x47, 0x49, 0x46] },
];

/**
 * Detect image MIME type from magic bytes.
 */
export function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  for (const { mime, magic } of IMAGE_SIGNATURES) {
    if (bytes.length < magic.length) continue;
    let matches = true;
    for (let i = 0; i < magic.length; i++) {
      if (magic[i] >= 0 && bytes[i] !== magic[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return mime;
  }
  return null;
}

/**
 * Get file extension from a MIME type.
 */
export function extFromMimeType(mimeType: string | null | undefined): string {
  if (!mimeType) return "bin";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/ktx2": "ktx2",
    "image/gif": "gif",
    "application/octet-stream": "bin",
  };
  return map[mimeType] || mimeType.split("/").pop() || "bin";
}
