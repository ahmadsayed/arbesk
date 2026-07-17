/**
 * Format registry entry point.
 *
 * Importing this module registers the built-in glTF/GLB/3MF handlers.
 * ESM module caching makes this idempotent.
 */

import { registerFormatHandler } from "./registry.js";
import { gltfHandler } from "./handlers/gltf-handler.js";
import { glbHandler } from "./handlers/glb-handler.js";
import { threeMfHandler } from "./handlers/3mf-handler.js";

registerFormatHandler(gltfHandler);
registerFormatHandler(glbHandler);
registerFormatHandler(threeMfHandler);

export {
  registerFormatHandler,
  getFormatHandler,
  detectAssetFormat,
  resolveFormatHandler,
  listFormatHandlers,
  _resetFormatRegistry,
} from "./registry.js";
