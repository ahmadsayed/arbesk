/**
 * Featured landing-page assets (src/api/featured.ts + routes/featured.ts):
 * curated ids resolve live to name / thumbnail / creator; an unreadable entry
 * is skipped, never fatal; results are cached.
 */
import { describe, expect, jest, test } from "bun:test";
import request from "supertest";
import { mountRoutes } from "../helpers/hono.js";
import {
  createFeaturedCache,
  resolveFeatured,
  resolveFeaturedAsset,
} from "../../src/api/featured.ts";
import featuredRoutes from "../../src/api/routes/featured.ts";

const OWNER = "0x407EDFCFD16A5623012BBB778BD47A2BF861ED40";
const GATEWAY = "https://gw.example/ipfs/";

const CAVE = { chainId: 84532, tokenId: "3686", assetId: "asset_cave" };
const TABLE = { chainId: 84532, tokenId: "2233", assetId: "asset_table" };

/** Chain + IPFS fakes: token 3686 holds cave; token 2233 holds table. */
function makePorts(overrides = {}) {
  const blobs = {
    colCave: { type: "collection", assets: { asset_cave: "caveV9" } },
    colTable: { type: "collection", assets: { asset_table: "tableV7" } },
    caveV9: { name: "cave", thumbnail: { type: "snapshot", cid: "thumbCave" } },
    tableV7: { name: "table", thumbnail: "thumbTable" },
  };
  return {
    tokenUri: jest.fn(async (tokenId) =>
      tokenId === "3686" ? "ipfs://colCave" : `${GATEWAY}colTable`,
    ),
    ownerOf: jest.fn(async () => OWNER),
    readJson: jest.fn(async (cid) => {
      if (!(cid in blobs)) throw new Error(`not found ${cid}`);
      return blobs[cid];
    }),
    gatewayBase: () => GATEWAY,
    ...overrides,
  };
}

describe("resolveFeaturedAsset", () => {
  test("reads the asset's latest manifest from its collection", async () => {
    const ports = makePorts();
    expect(await resolveFeaturedAsset(CAVE, ports)).toEqual({
      ...CAVE,
      name: "cave",
      creator: OWNER.toLowerCase(),
      thumbnailUrl: `${GATEWAY}thumbCave`,
    });
    expect(ports.readJson).toHaveBeenCalledWith("colCave");
    expect(ports.readJson).toHaveBeenCalledWith("caveV9");
  });

  test("accepts gateway-style token URIs and string thumbnails", async () => {
    const asset = await resolveFeaturedAsset(TABLE, makePorts());
    expect(asset.name).toBe("table");
    expect(asset.thumbnailUrl).toBe(`${GATEWAY}thumbTable`);
  });

  test("an asset without a thumbnail resolves with thumbnailUrl null", async () => {
    const ports = makePorts({
      readJson: async (cid) =>
        cid === "colCave"
          ? { assets: { asset_cave: "bare" } }
          : { name: "bare asset" },
    });
    const asset = await resolveFeaturedAsset(CAVE, ports);
    expect(asset.thumbnailUrl).toBe(null);
    expect(asset.name).toBe("bare asset");
  });

  test("rejects when the asset is no longer in the collection", async () => {
    const entry = { ...CAVE, assetId: "asset_removed" };
    await expect(resolveFeaturedAsset(entry, makePorts())).rejects.toThrow(
      /asset_removed/,
    );
  });
});

describe("resolveFeatured", () => {
  test("skips and logs entries that fail, keeping list order", async () => {
    const log = jest.fn();
    const ports = makePorts({
      ownerOf: jest.fn(async (tokenId) => {
        if (tokenId === "9999") throw new Error("ERC721NonexistentToken");
        return OWNER;
      }),
    });
    const burned = { chainId: 84532, tokenId: "9999", assetId: "asset_x" };
    const result = await resolveFeatured([TABLE, burned, CAVE], ports, log);
    expect(result.map((a) => a.name)).toEqual(["table", "cave"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("asset_x");
  });
});

describe("createFeaturedCache", () => {
  test("serves the cached value within the TTL and reloads after it", async () => {
    let now = 0;
    const load = jest.fn(async () => [now]);
    const get = createFeaturedCache(load, 1000, () => now);
    expect(await get()).toEqual([0]);
    now = 999;
    expect(await get()).toEqual([0]);
    now = 1000;
    expect(await get()).toEqual([1000]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("concurrent callers share one in-flight load", async () => {
    const load = jest.fn(async () => ["x"]);
    const get = createFeaturedCache(load, 1000, () => 0);
    await Promise.all([get(), get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a failed load is not cached", async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(["ok"]);
    const get = createFeaturedCache(load, 1000, () => 0);
    await expect(get()).rejects.toThrow("boom");
    expect(await get()).toEqual(["ok"]);
  });
});

describe("GET /featured", () => {
  test("returns the resolved assets with a cache header", async () => {
    const app = mountRoutes(
      "/featured",
      featuredRoutes({}, { entries: [CAVE, TABLE], ports: makePorts() }),
    );
    const res = await request(app).get("/featured");
    expect(res.status).toBe(200);
    expect(res.body.assets.map((a) => a.name)).toEqual(["cave", "table"]);
    expect(res.headers["cache-control"]).toContain("max-age=");
  });

  test("an empty curated list returns an empty array", async () => {
    const app = mountRoutes(
      "/featured",
      featuredRoutes({}, { entries: [], ports: makePorts() }),
    );
    const res = await request(app).get("/featured");
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });
});
