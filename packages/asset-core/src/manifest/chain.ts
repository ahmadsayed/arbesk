/**
 * Manifest chain walk.
 */

import { getRuntime } from "../runtime.ts";

export interface ManifestChainEntry {
  cid: string;
  version: any;
  name: string | null;
  nodeCount: number;
}

/**
 * Walks a manifest chain backward via `prev_asset_manifest_cid` links.
 */
export async function getManifestChain(
  cid: string,
  maxDepth: number = 50
): Promise<ManifestChainEntry[]> {
  const chain: ManifestChainEntry[] = [];
  let current: string | null = cid;
  while (current && chain.length < maxDepth) {
    try {
      const manifest = await getRuntime().ipfsRead.getJSON(current);
      chain.push({
        cid: current,
        version: manifest.version || 1,
        name: manifest.name || null,
        nodeCount: (manifest.scene?.nodes || []).length,
      });
      current = manifest.prev_asset_manifest_cid || null;
    } catch {
      break;
    }
  }
  return chain;
}
