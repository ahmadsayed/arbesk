/**
 * Catalog — collection/asset listing and name resolution.
 *
 * The read half of the Arbesk catalog: walk the chain (indexer → tokenURI →
 * collection manifest → asset manifests) through injected ports. This is the
 * same two-level walk the Library UI performs client-side, expressed as
 * env-agnostic domain functions over CollectionReadPort + IpfsReadPort.
 *
 * No HTTP/web3/chain wiring lives here — the host injects the ports. Access
 * policy (owner/editor/viewer) is deliberately NOT decided here; that is the
 * authz package's job. This module answers what is there, not who may read it.
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
 * List all collections reachable by address (owned + shared, deduped).
 * A token whose tokenURI reverts or whose manifest is not a collection is skipped.
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
 * List the assets of one collection token. An asset whose manifest is missing
 * or unreadable is skipped.
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
 * Resolve a collection by name (case-insensitive, trimmed). Returns the
 * collection summary (with its tokenId) or null.
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
 * Resolve an asset by name within one collection (case-insensitive, trimmed).
 * Returns { assetID, cid } or null.
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
