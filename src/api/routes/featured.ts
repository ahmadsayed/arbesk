import { Hono } from "hono";
import type { StorageAdapter } from "../storage/index.ts";
import { getTokenOwner, getTokenUri } from "../authorization.ts";
import { maybeDecompress } from "../ipfs-utils.ts";
import {
  createFeaturedCache,
  resolveFeatured,
} from "../featured.ts";
import type { FeaturedEntry, FeaturedPorts } from "../featured.ts";
import featuredList from "../featured-assets.json" with { type: "json" };

const CACHE_TTL_MS = 5 * 60 * 1000;

function storagePorts(storage: StorageAdapter): FeaturedPorts {
  return {
    tokenUri: (tokenId, chainId) => getTokenUri(tokenId, chainId),
    ownerOf: (tokenId, chainId) => getTokenOwner(tokenId, chainId),
    readJson: async (cid) => JSON.parse(await maybeDecompress(await storage.catBytes(cid))),
    gatewayBase: () => storage.gatewayBase(),
  };
}

/**
 * Featured assets for the landing page.
 *
 * GET /api/v1/featured
 * Returns `{ assets: FeaturedAsset[] }` for the curated featured-assets.json
 * list, resolved live and cached for 5 minutes (the cache is what keeps this
 * public, unauthenticated route cheap). Entries that can't be read are left out.
 */
export default function featuredRoutes(
  storage: StorageAdapter,
  {
    entries = featuredList as FeaturedEntry[],
    ports = storagePorts(storage),
  }: { entries?: FeaturedEntry[]; ports?: FeaturedPorts } = {},
) {
  const app = new Hono();
  const getFeatured = createFeaturedCache(
    () => resolveFeatured(entries, ports),
    CACHE_TTL_MS,
  );

  app.get("/", async (c) => {
    const assets = await getFeatured();
    c.header("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
    return c.json({ assets });
  });

  return app;
}
