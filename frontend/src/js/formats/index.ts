/**
 * Format registry entry point.
 *
 * Importing this module registers the built-in glTF/GLB/3MF handlers.
 * ESM module caching makes this idempotent.
 */

import { registerFormatHandler } from "./registry.ts";
import { gltfHandler } from "./handlers/gltf-handler.ts";
import { glbHandler } from "./handlers/glb-handler.ts";
import { threeMfHandler } from "./handlers/3mf-handler.ts";

registerFormatHandler(gltfHandler);
registerFormatHandler(glbHandler);
registerFormatHandler(threeMfHandler);

export {
  resolveFormatHandler,
  listFormatHandlers,
} from "./registry.ts";
