import type { ExecutorPort, ExecutorOp } from "../types.ts";
import { compose } from "../formats/gltf/composer.ts";
import { decompose } from "../formats/gltf/decomposer.ts";
import { decompose as decomposeGlb } from "../formats/gltf/glb-parser.ts";
import { applyNodeColors } from "../formats/gltf/source-color-editor.ts";

/**
 * Inline (calling-thread) op table. Each op takes the SAME single-payload
 * argument the glTF Web Worker method of the same name takes, and returns the
 * same shape, so async-gltf.ts can dispatch through the ExecutorPort without
 * caring which side runs it (see worker-executor.ts for the browser pool).
 */
const OPS: Record<ExecutorOp, (payload: any) => Promise<any>> = {
  compose: async (payload) => {
    const { compositeJson } = payload || {};
    if (!compositeJson) throw new Error("compose: gltfJson is null");
    return { composedBytes: await compose(compositeJson) };
  },

  decomposeGltf: async (payload) => {
    const { gltfJson, credential = null, options = {} } = payload || {};
    if (!gltfJson) throw new Error("decomposeGltf: gltf is null");
    const { composite } = await decompose(gltfJson, { credential, ...options, store: false });
    return { composite, buffers: [], images: [] };
  },

  decomposeGlb: async (payload) => {
    const { arrayBuffer, credential = null, options = {} } = payload || {};
    if (!arrayBuffer) throw new Error("decomposeGlb: arrayBuffer is required");
    return decomposeGlb(arrayBuffer, undefined, { credential, ...options });
  },

  decomposeAndUploadGltf: async (payload) => {
    const { gltfJson, credential = null, options = {} } = payload || {};
    if (!gltfJson) {
      throw new Error("decomposeAndUploadGltf: gltfJson is required");
    }
    const { composite } = await decompose(gltfJson, {
      credential,
      compress: true,
      ...options,
      store: false,
    });
    return { composite, buffers: [], images: [] };
  },

  decomposeAndUploadGlb: async (payload) => {
    const { arrayBuffer, credential = null, options = {} } = payload || {};
    if (!arrayBuffer) {
      throw new Error("decomposeAndUploadGlb: arrayBuffer is required");
    }
    return decomposeGlb(arrayBuffer, undefined, {
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

export const inlineExecutor: ExecutorPort = {
  available: async () => true,
  exec: async (op, args) => {
    const fn = OPS[op];
    if (!fn) throw new Error("asset-core: unknown executor op " + JSON.stringify(op));
    return fn(args[0]);
  },
};
