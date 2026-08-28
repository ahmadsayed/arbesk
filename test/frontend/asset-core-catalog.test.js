/**
 * asset-core catalog module tests.
 *
 * Run in the default node environment (no jsdom), matching
 * asset-core-facade.test.js: the catalog walks the injected CollectionReadPort
 * + memory IPFS, no DOM required.
 */
import { createArbeskCore } from "@arbesk/asset-core/facade.js";
import { createMemoryIpfs } from "@arbesk/asset-core/storage/memory-ipfs.js";
import { _resetRuntimeForTesting } from "@arbesk/asset-core/runtime.js";

afterEach(() => _resetRuntimeForTesting());

test("catalog: listCollections + resolveCollectionByName", async () => {
  const { read, write } = createMemoryIpfs();
  const charCid = await write.writeJSON({ type: "collection", name: "Characters", assets: {} });
  const propCid = await write.writeJSON({ type: "collection", name: "Props", assets: { a: "bafy" } });
  const defaultCid = await write.writeJSON({ type: "collection", assets: {} });

  const port = {
    tokenURI: async (tokenId) => ({ "1": charCid, "2": propCid, "3": defaultCid })[tokenId],
    listTokens: async ({ scope }) => (scope === "owned" ? ["1", "2"] : ["3"]),
  };
  const core = createArbeskCore({ ipfsRead: read, ipfsWrite: write, collection: port });

  const collections = await core.listCollections("0xabc");
  expect(collections).toHaveLength(3);

  const characters = collections.find((c) => c.name === "Characters");
  expect(characters.tokenId).toBe("1");
  expect(characters.assetCount).toBe(0);
  expect(collections.find((c) => c.tokenId === "2").assetCount).toBe(1);

  const byName = await core.resolveCollectionByName("0xabc", "characters");
  expect(byName.tokenId).toBe("1");

  await expect(core.resolveCollectionByName("0xabc", "Nope")).resolves.toBeNull();
});

test("catalog: getCollectionAssets + resolveAssetByName", async () => {
  const { read, write } = createMemoryIpfs();
  const dragonCid = await write.writeJSON({
    type: "asset",
    name: "Dragon",
    version: 12,
    arbesk_format: "composite-3mf",
  });
  const castleCid = await write.writeJSON({ type: "asset", name: "Castle", version: 4 });
  const collectionCid = await write.writeJSON({
    type: "collection",
    name: "Characters",
    assets: { asset_dragon: dragonCid, asset_castle: castleCid },
  });

  const core = createArbeskCore({
    ipfsRead: read,
    ipfsWrite: write,
    collection: { tokenURI: async () => collectionCid, listTokens: async () => [] },
  });

  const assets = await core.getCollectionAssets("1");
  expect(assets).toHaveLength(2);

  const dragon = assets.find((a) => a.name === "Dragon");
  expect(dragon.version).toBe(12);
  expect(dragon.format).toBe("3mf");
  expect(assets.find((a) => a.name === "Castle").format).toBe("gltf");

  const hit = await core.resolveAssetByName("1", "dragon");
  expect(hit).toEqual({ assetID: "asset_dragon", cid: dragonCid });
});

test("catalog: missing CollectionReadPort throws a clear error", async () => {
  const { read, write } = createMemoryIpfs();
  const core = createArbeskCore({ ipfsRead: read, ipfsWrite: write });
  await expect(core.listCollections("0xabc")).rejects.toThrow(/CollectionReadPort/);
});
