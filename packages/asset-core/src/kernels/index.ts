import type { Kernels } from "../types.ts";
import { arrayBufferToBase64, base64ToBytes } from "../utils/encoding.ts";
import { murmur3_128 } from "../utils/hash.ts";

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;

/**
 * Copies a Uint8Array view into a standalone ArrayBuffer.
 * @remarks DataView must read exactly the caller's bytes, never the shared
 *   buffer pool behind a view.
 */
function toStandaloneBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
  }
  return bytes;
}

/**
 * Default kernels.
 * @remarks The GLB magic check is duplicated inline because importing
 *   glb-parser here would create a module cycle.
 */
export const defaultKernels: Kernels = {
  base64: {
    encode: (bytes) => arrayBufferToBase64(bytes),
    decode: (b64) => base64ToBytes(b64),
  },
  hash: {
    // `as any`: BufferSource is a DOM-lib name; the backend typecheck (ES2022
    // lib) pulls this module in transitively via the facade.
    sha256: async (bytes) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as any)),
    murmur3_128: (bytes, seed) => murmur3_128(bytes, seed),
  },
  glb: {
    isGLB: (bytes) => {
      const buffer = toStandaloneBuffer(bytes);
      if (!buffer || buffer.byteLength < 12) return false;
      const view = new DataView(buffer);
      return (
        view.getUint32(0, true) === GLB_MAGIC &&
        view.getUint32(4, true) === GLB_VERSION
      );
    },
  },
};
