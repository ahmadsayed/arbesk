/**
 * Shared GLB image-byte resolution — one implementation for the GLB parser
 * (main thread) and the glTF Web Worker, parameterized by log prefix.
 */

import { extractDataURI } from "../../utils/uri.ts";
import { detectImageMimeType } from "./image-mime.ts";

/** Resolve image bytes from a bufferView, sniffing the MIME type when absent. */
function resolveFromBufferView(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  img: any,
  index: number,
  mimeType: string | null,
  logPrefix: string
): { bytes: Uint8Array; mimeType: string | null } | null {
  const bufferView = composite.bufferViews?.[img.bufferView];
  if (!bufferView) {
    console.warn(
      `${logPrefix} image[${index}] bufferView ${img.bufferView} not found`
    );
    return null;
  }
  const srcBytes = bufferBytesByIndex[bufferView.buffer];
  if (!srcBytes) {
    console.warn(
      `${logPrefix} image[${index}] buffer ${bufferView.buffer} could not be resolved`
    );
    return null;
  }
  const byteOffset = bufferView.byteOffset || 0;
  const bytes = srcBytes.subarray(byteOffset, byteOffset + bufferView.byteLength);
  if (!mimeType) {
    mimeType = detectImageMimeType(bytes);
  }
  return { bytes, mimeType };
}

/**
 * Resolve an image entry's bytes + MIME type from a data-URI or a bufferView
 * (magic-byte sniff when the entry carries no mimeType). Returns null after
 * logging when the image can't be resolved or is empty.
 */
export function resolveGlbImageBytes(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  img: any,
  index: number,
  logPrefix: string
): { bytes: Uint8Array; mimeType: string | null } | null {
  let bytes: Uint8Array | null = null;
  let mimeType = img.mimeType || null;

  if (img.uri && img.uri.startsWith("data:")) {
    const extracted = extractDataURI(img.uri);
    if (extracted) {
      bytes = extracted.bytes;
      mimeType = mimeType || extracted.mimeType;
    }
  } else if (img.bufferView !== undefined) {
    const resolved = resolveFromBufferView(
      composite, bufferBytesByIndex, img, index, mimeType, logPrefix
    );
    if (!resolved) return null;
    bytes = resolved.bytes;
    mimeType = resolved.mimeType;
  } else {
    console.warn(
      `${logPrefix} image[${index}] has no uri or bufferView, skipping`
    );
    return null;
  }

  if (!bytes || bytes.length === 0) {
    console.warn(`${logPrefix} image[${index}] empty payload, skipping`);
    return null;
  }
  return { bytes, mimeType };
}
