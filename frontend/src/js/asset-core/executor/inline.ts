import type { ExecutorPort, ExecutorOp } from "../types.ts";
import { composeGlTF } from "../gltf/composer.ts";
import { decomposeGlTF } from "../gltf/decomposer.ts";
import { decomposeGLB } from "../gltf/glb-parser.ts";
import { applyNodeColors } from "../gltf/source-color-editor.ts";

/**
 * Inline (calling-thread) op table. Each op takes the SAME single-payload
 * argument the glTF Web Worker method of the same name takes, and returns the
 * same shape, so async-gltf.ts can dispatch through the ExecutorPort without
 * caring which side runs it (see worker-executor.ts for the browser pool).
 *
 * Differences from the worker, by design:
 *  - `compose`/`composeToBytes` ignore `gatewayBase` (reads go through the
 *    injected IpfsReadPort instead of a gateway URL).
 *  - `decomposeGltf`/`decomposeAndUploadGltf` upload extracted components as
 *    they decompose (main-thread decomposer.ts always has), so they return
 *    empty `buffers`/`images` lists like the worker's upload variants do.
 *  - `decomposeGlb` stores via the IpfsWritePort and returns `compositeCid`
 *    (worker `decomposeGlb` is extract-only; async-gltf only ever dispatches
 *    `decomposeAndUploadGlb`, which matches this shape).
 */
const OPS: Record<ExecutorOp, (payload: any) => Promise<any>> = {
  compose: async (payload) => {
    const { compositeJson } = payload || {};
    if (!compositeJson) throw new Error("compose: gltfJson is null");
    return { composedJson: await composeGlTF(compositeJson) };
  },

  composeToBytes: async (payload) => {
    const { composedJson } = await OPS.compose(payload);
    return {
      composedBytes: new TextEncoder().encode(JSON.stringify(composedJson)),
    };
  },

  decomposeGltf: async (payload) => {
    const { gltfJson, credential = null, options = {} } = payload || {};
    if (!gltfJson) throw new Error("decomposeGltf: gltf is null");
    const composite = await decomposeGlTF(gltfJson, credential, options);
    return { composite, buffers: [], images: [] };
  },

  decomposeGlb: async (payload) => {
    const { arrayBuffer, credential = null, options = {} } = payload || {};
    if (!arrayBuffer) throw new Error("decomposeGlb: arrayBuffer is required");
    return decomposeGLB(arrayBuffer, undefined, { credential, ...options });
  },

  decomposeAndUploadGltf: async (payload) => {
    const { gltfJson, credential = null, options = {} } = payload || {};
    if (!gltfJson) {
      throw new Error("decomposeAndUploadGltf: gltfJson is required");
    }
    const composite = await decomposeGlTF(gltfJson, credential, {
      compress: true,
      ...options,
    });
    return { composite, buffers: [], images: [] };
  },

  decomposeAndUploadGlb: async (payload) => {
    const { arrayBuffer, credential = null, options = {} } = payload || {};
    if (!arrayBuffer) {
      throw new Error("decomposeAndUploadGlb: arrayBuffer is required");
    }
    return decomposeGLB(arrayBuffer, undefined, {
      compress: true,
      credential,
      ...options,
    });
  },

  bakeSourceColors: async (payload) => {
    const { gltfJson, nodeColors } = payload || {};
    if (!gltfJson) throw new Error("bakeSourceColors: gltfJson is required");
    if (!nodeColors || Object.keys(nodeColors).length === 0) {
      return { bakedJson: gltfJson, modified: 0, skipped: 0 };
    }
    const bakedJson = JSON.parse(JSON.stringify(gltfJson));
    const { modified, skipped } = applyNodeColors(bakedJson, nodeColors);
    return { bakedJson, modified, skipped };
  },
};

/**
 * Runs pipeline ops on the calling thread — backend default and browser
 * fallback when module workers are unavailable.
 */
export const inlineExecutor: ExecutorPort = {
  available: async () => true,
  exec: async (op, args) => {
    const fn = OPS[op];
    if (!fn) throw new Error(`asset-core: unknown executor op "${op}"`);
    return fn(args[0]);
  },
};
