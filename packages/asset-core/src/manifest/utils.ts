/**
 * Arbesk Manifest Utilities
 *
 * Shared helpers for working with fractal manifest structures, plus the
 * canonical runtime manifest validation (zod schema in `./schema.ts`).
 * `getSceneNodes` is used by the manifest chain walker; `bumpManifestVersion`
 * is exported for backend tests only (the frontend builds manifests itself).
 */

import { manifestSchema } from "./schema.ts";
import type { Manifest } from "./schema.ts";

export { manifestSchema };
export type { Manifest };

/**
 * Safe accessor for manifest scene nodes.
 * Ensures the scene.nodes array always exists.
 */
export function getSceneNodes(manifest: {
  scene?: { nodes?: any[] };
}): any[] {
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];
  return manifest.scene.nodes;
}

/**
 * Bump manifest version and timestamp for a new version.
 */
export function bumpManifestVersion(
  manifest: {
    version?: number;
    timestamp?: number;
    prev_asset_manifest_cid?: string | null;
  },
  prevCid: string | null = null,
): void {
  manifest.version = (manifest.version || 0) + 1;
  manifest.timestamp = Date.now();
  if (prevCid !== null) {
    manifest.prev_asset_manifest_cid = prevCid;
  }
}

/**
 * Validate a manifest object. Returns { valid: true, data } or
 * { valid: false, errors }.
 */
export function validateManifest(
  manifest: unknown,
): { valid: true; data: Manifest } | { valid: false; errors: string[] } {
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    };
  }
  return { valid: true, data: result.data };
}
