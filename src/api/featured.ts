/**
 * Featured assets for the landing page ("Made in Arbesk").
 * @remarks The curated list (featured-assets.json) holds ids only; names,
 *   thumbnails and creators are read live from the chain and IPFS, so cards
 *   follow each asset's latest version. One unreadable entry (burned token,
 *   removed asset, IPFS timeout) is skipped, never fatal to the list.
 */

/** One curated entry: a collection token and the asset inside it. */
export interface FeaturedEntry {
  chainId: number;
  tokenId: string;
  assetId: string;
}

/** A resolved card for the landing page. */
export interface FeaturedAsset extends FeaturedEntry {
  name: string;
  /** collection owner, lowercased (the landing page derives the profile id) */
  creator: string;
  thumbnailUrl: string | null;
}

/** Chain and IPFS reads, injected so the resolution logic stays testable. */
export interface FeaturedPorts {
  tokenUri(tokenId: string, chainId: number): Promise<string>;
  ownerOf(tokenId: string, chainId: number): Promise<string>;
  readJson(cid: string): Promise<any>;
  gatewayBase(): string;
}

/** CID from `ipfs://<cid>` or `<gateway>/ipfs/<cid>` token URIs. */
function cidFromTokenUri(uri: string): string {
  return uri.replace(/^ipfs:\/\//, "").replace(/^.*\/ipfs\//, "");
}

/** Mirrors the frontend's extractThumbnailCid (utils/thumbnail.ts). */
function thumbnailCid(thumbnail: any): string | null {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || null;
}

/**
 * Resolves one curated entry to its card data.
 * @throws when the token, collection or asset can't be read
 */
export async function resolveFeaturedAsset(
  entry: FeaturedEntry,
  ports: FeaturedPorts,
): Promise<FeaturedAsset> {
  const [uri, owner] = await Promise.all([
    ports.tokenUri(entry.tokenId, entry.chainId),
    ports.ownerOf(entry.tokenId, entry.chainId),
  ]);
  const collection = await ports.readJson(cidFromTokenUri(uri));
  const assetCid = collection?.assets?.[entry.assetId];
  if (!assetCid) {
    throw new Error(`asset ${entry.assetId} is not in collection ${entry.tokenId}`);
  }
  const manifest = await ports.readJson(assetCid);
  const thumb = thumbnailCid(manifest?.thumbnail);
  return {
    ...entry,
    name: manifest?.name || "Untitled",
    creator: owner.toLowerCase(),
    thumbnailUrl: thumb ? `${ports.gatewayBase()}${thumb}` : null,
  };
}

/** Resolves every entry, in list order, skipping (and logging) failures. */
export async function resolveFeatured(
  entries: FeaturedEntry[],
  ports: FeaturedPorts,
  log: (message: string) => void = console.warn,
): Promise<FeaturedAsset[]> {
  const results = await Promise.allSettled(
    entries.map((entry) => resolveFeaturedAsset(entry, ports)),
  );
  return results.flatMap((result, i) => {
    if (result.status === "fulfilled") return [result.value];
    const { tokenId, assetId } = entries[i];
    log(
      `[FEATURED] skipped ${tokenId.slice(0, 10)}…/${assetId}: ` +
        String((result.reason as Error)?.message ?? result.reason),
    );
    return [];
  });
}

/**
 * Wraps a loader in a TTL cache shared by concurrent callers.
 * @remarks A rejected load is not cached, so the next request retries.
 */
export function createFeaturedCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<T> {
  let cached: { value: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;
  return () => {
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    inflight ??= load()
      .then((value) => {
        cached = { value, at: now() };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
