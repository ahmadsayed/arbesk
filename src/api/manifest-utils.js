/**
 * Arbesk Manifest Utilities
 *
 * Shared helpers for working with fractal manifest structures.
 * Used by both backend API routes.
 */

/**
 * Safe accessor for manifest scene nodes.
 * Ensures the scene.nodes array always exists.
 */
export function getSceneNodes(manifest) {
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];
  return manifest.scene.nodes;
}

/**
 * Bump manifest version and timestamp for a new version.
 */
export function bumpManifestVersion(manifest, prevCid = null) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.timestamp = Date.now();
  if (prevCid !== null) {
    manifest.prev_asset_manifest_cid = prevCid;
  }
}
