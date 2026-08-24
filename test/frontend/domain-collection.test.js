/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import {
  adoptOpenedCollection,
  selectCollection,
  clearSelectedCollection,
  clearActiveCollection,
  adoptPublishedCollection,
  getActiveCollectionTokenId,
  getSelectedCollectionId,
  publishCollection,
} from "@arbesk/asset-core/domain/collection.js";
import {
  assetStore,
  _resetForTesting,
} from "@arbesk/asset-core/domain/asset-store.js";
import { initRuntime } from "@arbesk/asset-core/runtime.js";

beforeEach(() => {
  _resetForTesting();
  window.Web3 = {
    utils: {
      soliditySha3: jest.fn((...args) => {
        const payload = JSON.stringify(args);
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
          hash = (hash << 5) - hash + payload.charCodeAt(i);
          hash |= 0;
        }
        return "0x" + Math.abs(hash).toString(16).padStart(64, "0");
      }),
    },
  };
  // asset-core runtime seam: deriveDefaultCollectionId now hashes through the
  // injected HashPort instead of the window.Web3 CDN global. The port
  // delegates to the fake above so derived ids stay byte-identical.
  initRuntime({
    ipfsRead: { getJSON: async () => null },
    ipfsWrite: { write: async () => "", writeJSON: async () => "" },
    hash: {
      soliditySha3: (...args) => window.Web3.utils.soliditySha3(...args),
      keccak256: () => "0x",
    },
  });
});

test("adoptOpenedCollection sets active token and optionally clears selection", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  expect(getActiveCollectionTokenId()).toBe("7");
  expect(getSelectedCollectionId()).toBeNull();
});

test("selectCollection / clearSelectedCollection", () => {
  selectCollection("9");
  expect(getSelectedCollectionId()).toBe("9");
  clearSelectedCollection();
  expect(getSelectedCollectionId()).toBeNull();
});

test("clearActiveCollection clears both fields", () => {
  adoptOpenedCollection("7", { clearSelectedCollection: true });
  selectCollection("9");
  clearActiveCollection();
  expect(getActiveCollectionTokenId()).toBeNull();
  expect(getSelectedCollectionId()).toBeNull();
});

test("adoptPublishedCollection stringifies tokenId", () => {
  adoptPublishedCollection(42);
  expect(getActiveCollectionTokenId()).toBe("42");
});

test("publishCollection mints a new default collection and adopts identity", async () => {
  const onAdoptIdentity = jest.fn();
  const deps = {
    getOwnerOf: jest.fn().mockResolvedValue(null),
    getTokenURI: jest.fn().mockResolvedValue(null),
    getCollectionManifest: jest.fn().mockResolvedValue(null),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyNewCollection"),
    republishCollection: jest.fn().mockResolvedValue(undefined),
    publishNewToken: jest.fn().mockResolvedValue(undefined),
    onAdoptIdentity,
  };

  const out = await publishCollection(
    "bafyAsset",
    "asset_1",
    "0xOwner",
    deps
  );

  expect(deps.writeJSONToIPFS).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "collection",
      assets: { asset_1: "bafyAsset" },
      version: 1,
    }),
    null,
    expect.objectContaining({ type: "collection" })
  );
  expect(deps.publishNewToken).toHaveBeenCalledWith(
    "bafyNewCollection",
    out.tokenId,
    "0xOwner"
  );
  expect(getActiveCollectionTokenId()).toBe(out.tokenId);
  expect(onAdoptIdentity).toHaveBeenCalledWith({
    tokenId: out.tokenId,
    assetId: "asset_1",
    isNew: true,
  });
});

test("publishCollection republishes an existing collection", async () => {
  assetStore.set({ activeCollectionTokenId: "7" });
  const deps = {
    getOwnerOf: jest.fn().mockResolvedValue("0xOwner"),
    getTokenURI: jest.fn().mockResolvedValue("bafyPrev"),
    getCollectionManifest: jest.fn().mockResolvedValue({
      type: "collection",
      asset_id: "col_1",
      version: 1,
      assets: {},
    }),
    writeJSONToIPFS: jest.fn().mockResolvedValue("bafyNewCollection"),
    republishCollection: jest.fn().mockResolvedValue(undefined),
    publishNewToken: jest.fn().mockResolvedValue(undefined),
    onAdoptIdentity: jest.fn(),
  };

  const out = await publishCollection(
    "bafyAsset",
    "asset_1",
    "0xOwner",
    deps
  );

  expect(out.tokenId).toBe("7");
  expect(out.isNew).toBe(false);
  expect(deps.republishCollection).toHaveBeenCalledWith(
    "7",
    "bafyNewCollection",
    "0xOwner"
  );
  expect(deps.publishNewToken).not.toHaveBeenCalled();
  expect(getActiveCollectionTokenId()).toBe("7");
});
