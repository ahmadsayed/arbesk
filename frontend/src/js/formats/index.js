/**
 * Format registry entry point.
 *
 * Importing this module registers the built-in glTF/GLB handlers.
 * ESM module caching makes this idempotent.
 */

import { registerFormatHandler } from "./registry.js";
import { gltfHandler } from "./handlers/gltf-handler.js";
import { glbHandler } from "./handlers/glb-handler.js";

registerFormatHandler(gltfHandler);
registerFormatHandler(glbHandler);

export {
  registerFormatHandler,
  getFormatHandler,
  detectAssetFormat,
  resolveFormatHandler,
  listFormatHandlers,
  _resetFormatRegistry,
} from "./registry.js";
