import type { Kernels } from "../types.ts";

/**
 * Placeholder default kernels — Task 10 replaces bodies with the real
 * implementations delegating to utils/encoding, utils/hash, gltf-core.
 */
export const defaultKernels: Kernels = {
  base64: {
    encode: () => { throw new Error("asset-core: base64 kernel not wired yet (Task 10)"); },
    decode: () => { throw new Error("asset-core: base64 kernel not wired yet (Task 10)"); },
  },
  hash: {
    sha256: async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
    murmur3_128: () => { throw new Error("asset-core: hash kernel not wired yet (Task 10)"); },
  },
  glb: {
    isGLB: () => { throw new Error("asset-core: glb kernel not wired yet (Task 10)"); },
  },
};
