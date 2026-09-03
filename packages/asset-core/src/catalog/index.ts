/**
 * Catalog — collection/asset listing and name resolution.
 * @remarks The read half of the catalog: walks the chain (indexer → tokenURI →
 *   collection manifest → asset manifests) through injected ports. No HTTP/web3
 *   wiring lives here, and access policy is deliberately not decided here —
 *   this module answers what is there, not who may read it.
 */

import { getRuntime } from "../runtime.ts";
import { detectFormat } from "../formats/index.ts";

/** One collection (a token) as surfaced by the catalog. */
export interface CollectionSummary {
  /** Collection token ID (uint256 as a decimal string, matching on-chain). */
  tokenId: string;
  /** Collection name; null for the default collection (host renders a fallback like My Library). */
  name: string | null;
  /** Number of assets in the collection's assets map. */
  assetCount: number;
}

/** One asset within a collection. */
export interface AssetSummary {
  /** The asset's key in the collection's assets map (opaque, not the name). */
  assetID: string;
  /** The asset manifest CID. */
  cid: string;
  /** Human asset name (from the asset manifest), or null. */
  name: string | null;
  /** Latest manifest version (string or number, per the wire schema). */
  version: string | number;
  /** Stored format from the manifest's arbesk_format marker (gltf, 3mf, example). */
  format: string;
}

function collectionPort() {
  const port = getRuntime().collection;
  if (!port) {
    throw new Error(
      "asset-core: catalog requires a CollectionReadPort — pass it via createArbeskCore config"
    );
  }
  return port;
}

/**
 * Lists all collections reachable by address (owned + shared, deduped).
 * @remarks Tokens whose tokenURI reverts or whose manifest is not a collection
 *   are skipped.
 */
export async function listCollections(
  address: string,
  chainId?: number
): Promise<CollectionSummary[]> {
  const port = collectionPort();
  const [owned, shared] = await Promise.all([
    port.listTokens({ address, chainId, scope: "owned" }),
    port.listTokens({ address, chainId, scope: "shared" }),
  ]);
  const tokenIds = [...new Set([...owned, ...shared])];

  const summaries = await Promise.all(
    tokenIds.map(async (tokenId): Promise<CollectionSummary | null> => {
      try {
        const cid = await port.tokenURI(tokenId, chainId);
        const manifest = await getRuntime().ipfsRead.getJSON(cid);
        if (!manifest) return null;
        return {
          tokenId,
          name: typeof manifest.name === "string" ? manifest.name : null,
          assetCount: Object.keys(manifest.assets ?? {}).length,
        };
      } catch {
        return null;
      }
    })
  );

  return summaries.filter((s): s is CollectionSummary => s !== null);
}

/**
 * Lists the assets of one collection token.
 * @remarks Assets whose manifest is missing or unreadable are skipped.
 */
export async function getCollectionAssets(
  tokenId: string,
  chainId?: number
): Promise<AssetSummary[]> {
  const port = collectionPort();
  const cid = await port.tokenURI(tokenId, chainId);
  const manifest = await getRuntime().ipfsRead.getJSON(cid);
  const assets: Record<string, string> = manifest?.assets ?? {};

  const entries = await Promise.all(
    Object.entries(assets).map(
      async ([assetID, assetCid]): Promise<AssetSummary | null> => {
        try {
          const am = await getRuntime().ipfsRead.getJSON(assetCid);
          if (!am) return null;
          return {
            assetID,
            cid: assetCid,
            name: typeof am.name === "string" ? am.name : null,
            version: am.version ?? 1,
            format: detectFormat(am),
          };
        } catch {
          return null;
        }
      }
    )
  );

  return entries.filter((e): e is AssetSummary => e !== null);
}

/**
 * Resolves a collection by name (case-insensitive, trimmed).
 */
export async function resolveCollectionByName(
  address: string,
  name: string,
  chainId?: number
): Promise<CollectionSummary | null> {
  const target = name.trim().toLowerCase();
  const collections = await listCollections(address, chainId);
  return (
    collections.find(
      (c) => c.name !== null && c.name.toLowerCase() === target
    ) ?? null
  );
}

/**
 * Resolves an asset by name within one collection (case-insensitive, trimmed).
 */
export async function resolveAssetByName(
  tokenId: string,
  name: string,
  chainId?: number
): Promise<{ assetID: string; cid: string } | null> {
  const target = name.trim().toLowerCase();
  const assets = await getCollectionAssets(tokenId, chainId);
  const hit = assets.find(
    (a) => a.name !== null && a.name.toLowerCase() === target
  );
  return hit ? { assetID: hit.assetID, cid: hit.cid } : null;
}

/**
 * Returns the composite source CID when the manifest wraps one.
 * @remarks A collection asset may be stored either as a full asset manifest or,
 *   for CLI uploads, as the composite glTF/3MF JSON directly. Returns null when
 *   the manifest itself is the composite.
 */
export function resolveCompositeSourceCid(manifest: Record<string, any>): string | null {
  const src = manifest?.scene?.nodes?.[0]?.source?.cid;
  if (src && !manifest.buffers && !manifest.meshes && !manifest.arbesk_format) return src;
  return null;
}
