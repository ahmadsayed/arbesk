import type { ExecutorPort } from "../types.ts";

/**
 * Placeholder inline executor — Task 6 wires it to the real op table.
 * available() reports false so async-gltf falls back to its main-thread
 * path until then.
 */
export const inlineExecutor: ExecutorPort = {
  available: async () => false,
  exec: async () => {
    throw new Error("asset-core: inline executor not wired yet (Task 6)");
  },
};
