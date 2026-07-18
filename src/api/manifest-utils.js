/**
 * Arbesk Manifest Utilities
 *
 * Shared helpers for working with fractal manifest structures.
 * `getSceneNodes` is used by the manifest chain walker; `bumpManifestVersion`
 * is exported for backend tests only (the frontend builds manifests itself).
 */

/**
 * Safe accessor for manifest scene nodes.
 * Ensures the scene.nodes array always exists.
 *
 * @param {{ scene?: { nodes?: any[] } }} manifest
 * @returns {any[]}
 */
export function getSceneNodes(manifest) {
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];
  return manifest.scene.nodes;
}

/**
 * Bump manifest version and timestamp for a new version.
 *
 * @param {{ version?: number; timestamp?: number; prev_asset_manifest_cid?: string | null }} manifest
 * @param {string | null} [prevCid]
 */
export function bumpManifestVersion(manifest, prevCid = null) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.timestamp = Date.now();
  if (prevCid !== null) {
    manifest.prev_asset_manifest_cid = prevCid;
  }
}

// Re-export runtime manifest validation from schemas.
export { validateManifest } from "./schemas.js";
