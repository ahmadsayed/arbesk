/**
 * Arbesk Manifest Utilities
 *
 * Thin re-export of the canonical asset-core manifest module
 * (`packages/asset-core/src/manifest/utils.ts`) — keeps backend import
 * sites stable. `getSceneNodes` is used by the manifest chain walker;
 * `bumpManifestVersion` is exported for backend tests only (the frontend
 * builds manifests itself).
 */

export {
  getSceneNodes,
  bumpManifestVersion,
  validateManifest,
} from "@arbesk/asset-core/manifest/utils.js";
