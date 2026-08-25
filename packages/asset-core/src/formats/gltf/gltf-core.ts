/**
 * Arbesk glTF Core Transforms
 *
 * Pure compose/decompose logic shared by the main thread (composer.js,
 * decomposer.js, dedup.js) and the glTF Web Worker (workers/gltf-worker.js).
 * This module must stay free of DOM, session, network, and import-map
 * dependencies so the worker can import it — side effects (IPFS fetch,
 * upload) are injected by the caller.
 *
 * Compose:   `ipfs://<CID>` refs → base64 data URIs (self-contained glTF).
 * Decompose: data-URI buffers/images → extracted bytes handed to caller
 *            callbacks (upload to IPFS on the main thread, placeholder swap
 *            in the worker).
 */

import { extractDataURI } from "../../utils/uri.ts";

export const IPFS_URI_PREFIX = "ipfs://";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const GLB_CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

/**
 * Fast custom GLB serializer.
 *
 * Packs glTF JSON + optional BIN chunk into a GLB v2 container without
 * decoding/re-encoding mesh data, so content-addressed CIDs remain stable.
 *
 * @param json - glTF JSON object (dynamic schema)
 * @param binaryChunk - Optional BIN chunk
 * @returns GLB bytes
 */
function serializeGLBCustom(json: any, binaryChunk: ArrayBuffer | Uint8Array | null = null): ArrayBuffer {
  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  // GLB requires each chunk's data (including padding) to be a multiple of 4 bytes.
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const binPadding = binaryChunk ? (4 - (binaryChunk.byteLength % 4)) % 4 : 0;

  const headerLength = 12;
  const jsonChunkHeaderLength = 8;
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const binChunkHeaderLength = binaryChunk ? 8 : 0;
  const binChunkLength = binaryChunk ? binaryChunk.byteLength + binPadding : 0;
  const totalLength =
    headerLength +
    jsonChunkHeaderLength +
    jsonChunkLength +
    binChunkHeaderLength +
    binChunkLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, GLB_MAGIC, true);
  offset += 4;
  view.setUint32(offset, GLB_VERSION, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;

  // JSON chunk - chunkLength includes padding to match @gltf-transform/core.
  view.setUint32(offset, jsonChunkLength, true);
  offset += 4;
  view.setUint32(offset, GLB_CHUNK_TYPE_JSON, true);
  offset += 4;
  const jsonArray = new Uint8Array(buffer, offset, jsonBytes.length);
  jsonArray.set(jsonBytes);
  offset += jsonBytes.length;
  for (let i = 0; i < jsonPadding; i++) {
    view.setUint8(offset++, 0x20);
  }

  // BIN chunk - chunkLength includes padding to match @gltf-transform/core.
  if (binaryChunk) {
    view.setUint32(offset, binChunkLength, true);
    offset += 4;
    view.setUint32(offset, GLB_CHUNK_TYPE_BIN, true);
    offset += 4;
    const binArray = new Uint8Array(buffer, offset, binaryChunk.byteLength);
    binArray.set(new Uint8Array(binaryChunk));
    offset += binaryChunk.byteLength;
    for (let i = 0; i < binPadding; i++) {
      view.setUint8(offset++, 0);
    }
  }

  return buffer;
}

/**
 * Serialize a glTF JSON + optional binary chunk back into a GLB v2 container.
 *
 * Uses the fast custom serializer. It does not decode/re-encode mesh data, so
 * the binary payload (and therefore its content-addressed CID) stays identical.
 * This is kept as a utility for GLB export/download; the storage/edit path does
 * not re-serialize to GLB.
 *
 * @param json - glTF JSON object (dynamic schema)
 * @param binaryChunk - Optional BIN chunk
 * @returns GLB bytes
 */
export function serializeGLB(json: any, binaryChunk: ArrayBuffer | Uint8Array | null = null): ArrayBuffer {
  return serializeGLBCustom(json, binaryChunk);
}

/**
 * Check if a glTF JSON is already in composite format (any buffer or image
 * referencing `ipfs://<CID>`).
 */
export function isComposite(gltf: any): boolean {
  if (!gltf) return false;
  for (const buf of gltf.buffers || []) {
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  for (const img of gltf.images || []) {
    if (img.uri && img.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  return false;
}

/**
 * Convert a bare CID string to an ipfs:// URI.
 */
export function ipfsUriFromCid(cid: string): string {
  return IPFS_URI_PREFIX + cid;
}

/**
 * Convert an ipfs:// URI to a bare CID string.
 */
export function cidFromIpfsUri(uri: string): string | null {
  if (!uri || !uri.startsWith(IPFS_URI_PREFIX)) return null;
  return uri.slice(IPFS_URI_PREFIX.length);
}

/**
 * Attach Arbesk dedup metadata to a glTF buffer or image entry.
 *
 * @param item - glTF buffer/image entry (dynamic schema)
 */
export function attachDedupMeta(item: any, meta: object): any {
  return { ...item, _arbesk: meta };
}

/**
 * Remove Arbesk dedup metadata from all buffers/images in a composite glTF.
 * Returns a deep clone; the input is not mutated.
 *
 * @param composite - Composite glTF JSON (dynamic schema)
 * @returns Clean glTF JSON suitable for any glTF loader or serialization
 */
export function stripDedupMeta(composite: any): any {
  const cleaned = JSON.parse(JSON.stringify(composite));
  for (const item of [
    ...(cleaned.buffers || []),
    ...(cleaned.images || []),
  ]) {
    delete item._arbesk;
  }
  return cleaned;
}

/**
 * Compose a full standard glTF JSON from a composite glTF.
 *
 * Resolves every `ipfs://<CID>` buffer/image URI to a base64 data URI via the
 * injected fetcher and strips Arbesk metadata, so the result loads in any
 * standard glTF importer. Data/external URIs pass through unchanged.
 *
 * glTF 2.0 allows either `uri` or `bufferView` on an image, never both. The
 * composite storage form carries both, so the bufferView is dropped from any
 * image that has a uri — strict importers (Blender) reject the file otherwise.
 *
 * @param gltfJson - Composite glTF JSON (not mutated; dynamic schema)
 * @param fetchBase64
 *   Fetches a CID's payload and returns it base64-encoded.
 * @returns Standard glTF JSON with data URI buffers/images
 */
export async function composeGltfJson(
  gltfJson: any,
  fetchBase64: (cid: string, arbeskMeta: any) => Promise<string>
): Promise<any> {
  if (!gltfJson) throw new Error("composeGltfJson: gltfJson is null");

  // Deep clone + strip Arbesk metadata so the result is a standard glTF.
  const composed = stripDedupMeta(gltfJson);

  if (composed.buffers) {
    await Promise.all(
      composed.buffers.map(async (buf: any, i: number) => {
        if (!buf.uri || !buf.uri.startsWith(IPFS_URI_PREFIX)) return;
        const base64 = await fetchBase64(
          cidFromIpfsUri(buf.uri) as string,
          gltfJson.buffers?.[i]?._arbesk
        );
        composed.buffers[i] = {
          ...buf,
          uri: `data:application/octet-stream;base64,${base64}`,
        };
      })
    );
  }

  if (composed.images) {
    await Promise.all(
      composed.images.map(async (img: any, i: number) => {
        if (!img.uri) return;
        const { bufferView: _bufferView, ...rest } = img;
        if (!img.uri.startsWith(IPFS_URI_PREFIX)) {
          composed.images[i] = rest;
          return;
        }
        const mimeType = img.mimeType || "image/png";
        const base64 = await fetchBase64(
          cidFromIpfsUri(img.uri) as string,
          gltfJson.images?.[i]?._arbesk
        );
        composed.images[i] = {
          ...rest,
          uri: `data:${mimeType};base64,${base64}`,
        };
      })
    );
  }

  return composed;
}

interface DecomposeCallbacks {
  onBuffer?: (index: number, item: any, extracted: { bytes: Uint8Array; mimeType: string }) => Promise<object> | object;
  onImage?: (index: number, item: any, extracted: { bytes: Uint8Array; mimeType: string }) => Promise<object> | object;
  /** Log tag for skipped items */
  logPrefix?: string;
}

/**
 * Walk a standard glTF's buffers/images, extract every inline data URI, and
 * hand the bytes to caller callbacks that decide the replacement entry
 * (e.g. `ipfs://<CID>` after upload, or a worker placeholder).
 *
 * Already-decomposed (`ipfs://`) and external URIs are left untouched.
 * Returns a deep clone; the input is not mutated.
 *
 * @param gltfJson - Standard glTF 2.0 JSON (not mutated; dynamic schema)
 * @returns Composite-shaped glTF JSON with replaced URIs
 */
export async function decomposeGltfJson(
  gltfJson: any,
  { onBuffer, onImage, logPrefix = "[DECOMPOSE]" }: DecomposeCallbacks = {}
): Promise<any> {
  if (!gltfJson) throw new Error("decomposeGltfJson: gltfJson is null");

  const composite = structuredClone(gltfJson);

  if (composite.buffers) {
    await Promise.all(
      composite.buffers.map(async (buf: any, i: number) => {
        if (!buf.uri || buf.uri.startsWith(IPFS_URI_PREFIX)) return;
        const extracted = extractDataURI(buf.uri);
        if (!extracted) {
          console.warn(
            `${logPrefix} buffer[${i}] unrecognized URI: ${buf.uri.substring(0, 80)}...`
          );
          return;
        }
        const next = await onBuffer?.(i, buf, extracted);
        if (next) composite.buffers[i] = next;
      })
    );
  }

  if (composite.images) {
    await Promise.all(
      composite.images.map(async (img: any, i: number) => {
        if (!img.uri || img.uri.startsWith(IPFS_URI_PREFIX)) return;
        if (!img.uri.startsWith("data:")) {
          console.log(`${logPrefix} image[${i}] external URI, keeping as-is`);
          return;
        }
        const extracted = extractDataURI(img.uri);
        if (!extracted) {
          console.warn(`${logPrefix} image[${i}] failed to extract data URI`);
          return;
        }
        const next = await onImage?.(i, img, extracted);
        if (next) composite.images[i] = next;
      })
    );
  }

  return composite;
}
