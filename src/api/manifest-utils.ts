/**
 * Thin re-export of the canonical asset-core manifest module
 * (`packages/asset-core/src/manifest/utils.ts`).
 * @remarks Keeps backend import sites stable.
 */

export {
  getSceneNodes,
  bumpManifestVersion,
  validateManifest,
} from "@arbesk/asset-core/manifest/utils.js";
