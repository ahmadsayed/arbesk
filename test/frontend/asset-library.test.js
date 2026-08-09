/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, describe } from "@jest/globals";
import { assetStore, _resetForTesting as resetAssetState } from "../../frontend/src/js/domain/asset-store.js";
import { trimTokenId } from "../../frontend/src/js/utils/library-items.js";

let _tokenURIs = {};
let _manifests = {};

const closeAssetSpy = jest.fn(() => {
  assetStore.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetId: null,
    activeAssetName: null,
    currentManifest: null,
  });
});

beforeEach(() => {
  resetAssetState();
  closeAssetSpy.mockClear();
  _tokenURIs = {
    1: "bafyCollection1",
    2: "bafyCollection2",
  };
  _manifests = {
    bafyCollection1: {
      type: "collection",
      name: "Collection One",
      assets: { "asset-a": "bafyA" },
    },
    bafyCollection2: {
      type: "collection",
      name: "Collection Two",
      assets: { "asset-b": "bafyB", "asset-c": "bafyC" },
    },
    bafyA: { type: "asset", name: "Asset A" },
    bafyB: { type: "asset", name: "Asset B" },
    bafyC: { type: "asset", name: "Asset C" },
  };

  document.body.innerHTML = `<div id="assetLibraryBody"></div>`;
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: "0xOwner",
          contract: {
            getPastEvents: jest.fn().mockResolvedValue([]),
            methods: {
              tokenURI: (tokenId) => ({
                call:
                  _tokenURIs[tokenId] instanceof Error
                    ? jest.fn().mockRejectedValue(_tokenURIs[tokenId])
                    : jest.fn().mockResolvedValue(_tokenURIs[tokenId] || ""),
              }),
              listTokens: () => ({
                call: jest.fn().mockResolvedValue([]),
              }),
            },
          },
        })),
        _resetForTesting: jest.fn(),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
      getFromRemoteIPFS: jest.fn((cid) => {
        const manifest = _manifests[cid];
        if (!manifest) return Promise.reject(new Error(`Unknown CID ${cid}`));
        return Promise.resolve(manifest);
      }),
      getBase64FromRemoteIPFS: jest.fn().mockRejectedValue(new Error("no base64")),
      getBlobFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("no blob")),
      getArrayBufferFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("no array buffer")),
      getRawArrayBufferFromRemoteIPFS: jest.fn().mockRejectedValue(new Error("no raw buffer")),
      getManifestChain: jest.fn((cid) => Promise.resolve([{ cid, version: 1, name: null, nodeCount: 0 }])),
      isIpfsCidReachable: jest.fn().mockResolvedValue(true),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/domain/asset.js",
    () => ({
      closeAsset: closeAssetSpy,
      renameAsset: (name) => assetStore.set({ activeAssetName: name }),
      resetForNewAsset: jest.fn(),
      adoptLoadedManifestName: jest.fn(),
      adoptManifestName: jest.fn(),
      isDefaultAssetName: jest.fn(() => false),
      getAssetSnapshot: jest.fn(),
      getAssetState: () => assetStore.get(),
      getActiveAssetManifestCid: () => assetStore.get().activeAssetManifestCid,
      getLatestAssetManifestCid: () => assetStore.get().latestAssetManifestCid,
      getActiveAssetTokenId: () => assetStore.get().activeAssetTokenId,
      getActiveAssetId: () => assetStore.get().activeAssetId,
      getActiveAssetName: () => assetStore.get().activeAssetName,
      getCurrentManifest: () => assetStore.get().currentManifest,
      subscribeAsset: jest.fn(),
      adoptOpenedAsset: jest.fn(),
      activateAssetManifest: jest.fn(),
      setActiveManifestCid: jest.fn(),
      setLatestManifestCid: jest.fn(),
      clearAssetManifestCids: jest.fn(),
      cacheCurrentManifest: jest.fn(),
      recordSavedVersion: jest.fn(),
      adoptPublishedIdentity: jest.fn(),
    })
  );

  const mod = await import("../../frontend/src/js/ui/asset-library.js");
  return mod;
}

describe("renderAssetLibrary", () => {
  test("renders all owned collections when no active collection is set", async () => {
    const { initAssetLibrary, renderAssetLibrary } = await loadModule();
    initAssetLibrary();

    await renderAssetLibrary(["1", "2"], []);

    const cards = document.querySelectorAll(".asset-card");
    const names = [...cards].map((c) => c.querySelector(".asset-card-name").textContent);
    expect(names).toEqual(expect.arrayContaining(["Asset A", "Asset B", "Asset C"]));
    expect(cards).toHaveLength(3);
  });

  test("filters to only the active collection's assets", async () => {
    const { initAssetLibrary, renderAssetLibrary } = await loadModule();
    initAssetLibrary();

    assetStore.set({ activeCollectionTokenId: "2" });
    await renderAssetLibrary(["1", "2"], []);

    const cards = document.querySelectorAll(".asset-card");
    const names = [...cards].map((c) => c.querySelector(".asset-card-name").textContent);
    expect(names).toEqual(["Asset B", "Asset C"]);
    expect(cards).toHaveLength(2);
  });

  test("renders empty state when active collection has no assets", async () => {
    const { initAssetLibrary, renderAssetLibrary } = await loadModule();
    initAssetLibrary();

    _manifests.bafyCollection2.assets = {};
    assetStore.set({ activeCollectionTokenId: "2" });
    await renderAssetLibrary(["1", "2"], []);

    expect(document.querySelector(".asset-card")).toBeNull();
    expect(document.querySelector(".empty-state")).not.toBeNull();
  });

  test("renders inaccessible card for token whose IPFS load fails", async () => {
    const { initAssetLibrary, renderAssetLibrary } = await loadModule();
    initAssetLibrary();

    // Token 3 maps to a CID that is not in _manifests → getFromRemoteIPFS rejects
    _tokenURIs[3] = "bafyBroken";

    await renderAssetLibrary(["3"], []);

    const inaccessible = document.querySelector(".asset-card--inaccessible");
    expect(inaccessible).not.toBeNull();
    // Normal asset cards should not appear for the failing token
    expect(document.querySelector(".asset-card:not(.asset-card--inaccessible)")).toBeNull();
  });
});

describe("updateActiveAssetCard", () => {
  test("updates the active asset card from in-memory manifest without IPFS fetches", async () => {
    const {
      initAssetLibrary,
      renderAssetLibrary,
      updateActiveAssetCard,
    } = await loadModule();
    initAssetLibrary();

    // Render an initial card for asset-a inside collection 1.
    assetStore.set({ activeCollectionTokenId: "1" });
    await renderAssetLibrary(["1"], []);

    // Simulate a publish that updated the manifest in memory.
    assetStore.set({
      activeAssetTokenId: "1",
      activeAssetId: "asset-a",
      activeAssetManifestCid: "bafyAUpdated",
      currentManifest: {
        type: "asset",
        name: "Asset A Updated",
        thumbnail: { cid: "bafyThumbUpdated" },
        _manifestCid: "bafyAUpdated",
      },
    });

    const updated = await updateActiveAssetCard();

    expect(updated).toBe(true);
    const card = document.querySelector(
      '.asset-card[data-token-id="1"][data-asset-id="asset-a"]'
    );
    expect(card).not.toBeNull();
    expect(card.querySelector(".asset-card-name").textContent).toBe(
      "Asset A Updated"
    );
    expect(card.dataset.manifestCid).toBe("bafyAUpdated");
  });
});

describe("openAssetByTokenId error paths", () => {
  function seedDirtyState() {
    assetStore.set({
      activeAssetName: "Leftover",
      activeAssetManifestCid: "bafyOld",
      latestAssetManifestCid: "bafyOld",
      activeAssetTokenId: "42",
      activeAssetId: "asset-x",
      currentManifest: { type: "asset" },
      activeCollectionTokenId: "7",
      selectedCollectionId: "sel-1",
    });
  }

  function expectFullyCleared() {
    const s = assetStore.get();
    expect(s.activeAssetName).toBeNull();
    expect(s.activeAssetManifestCid).toBeNull();
    expect(s.latestAssetManifestCid).toBeNull();
    expect(s.activeAssetTokenId).toBeNull();
    expect(s.activeAssetId).toBeNull();
    expect(s.currentManifest).toBeNull();
    expect(s.activeCollectionTokenId).toBeNull();
    expect(s.selectedCollectionId).toBeNull();
  }

  test("empty tokenURI routes the clear through closeAsset", async () => {
    const { openAssetByTokenId } = await loadModule();
    seedDirtyState();

    // Token 99 has no tokenURI → early-return clear path
    await openAssetByTokenId("99");

    expect(closeAssetSpy).toHaveBeenCalledTimes(1);
    expectFullyCleared();
  });

  test("tokenURI rejection routes the clear through closeAsset", async () => {
    const { openAssetByTokenId } = await loadModule();
    seedDirtyState();
    _tokenURIs[98] = new Error("execution reverted");

    await openAssetByTokenId("98");

    expect(closeAssetSpy).toHaveBeenCalledTimes(1);
    expectFullyCleared();
  });
});

describe("trimTokenId", () => {
  test("short id is returned with hash prefix", () => {
    expect(trimTokenId("12345678")).toBe("#12345678");
  });

  test("long id is trimmed to first4…last4", () => {
    expect(trimTokenId("107798772824060442692498426158461")).toBe("#1077…8461");
  });

  test("numeric input is converted to string", () => {
    expect(trimTokenId(9)).toBe("#9");
  });

  test("exactly 9 chars triggers trimming", () => {
    expect(trimTokenId("123456789")).toBe("#1234…6789");
  });
});
