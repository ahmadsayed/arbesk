/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, afterEach } from "@jest/globals";
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

let _expandTokenToAssets = jest.fn().mockResolvedValue([]);

beforeEach(() => {
  _resetForTesting();
  _expandTokenToAssets = jest.fn().mockResolvedValue([]);
  window.matchMedia =
    window.matchMedia ||
    jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn() });
  document.body.innerHTML = `
    <div id="libraryItems"></div>
    <span id="libraryItemCount"></span>
    <span id="libraryLiveRegion"></span>
  `;
});

afterEach(() => {
  document.querySelectorAll(".dialog-backdrop").forEach((el) => el.remove());
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../frontend/src/js/ui/asset-library.js",
    () => ({
      expandTokenToAssets: jest.fn((...args) => _expandTokenToAssets(...args)),
      fetchAssetLibrary: jest.fn().mockResolvedValue({ owned: [], shared: [] }),
      refreshAssetLibrary: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: "0xOwner",
          contract: {
            methods: {
              tokenURI: (tokenId) => ({
                call: jest.fn().mockResolvedValue(`bafyCollection${tokenId}`),
              }),
            },
          },
        })),
        _resetForTesting: jest.fn(),
      },
    })
  );

  const mod = await import("../frontend/src/js/library-init.js");
  return mod;
}

test("loadCurrentAssets loads only the current collection's assets", async () => {
  const { loadCurrentAssets } = await loadModule();

  libraryState.set({
    collections: [{ id: "c1", tokenId: "1", name: "Weapons", role: "owner" }],
    currentCollectionTokenId: "1",
  });

  _expandTokenToAssets.mockResolvedValue([
    {
      tokenId: "1",
      assetId: "asset-a",
      manifestCid: "bafyA",
      name: "a.glb",
      thumbnail: null,
    },
  ]);

  await loadCurrentAssets();

  expect(libraryState.get().assets).toHaveLength(1);
  expect(libraryState.get().assets[0]).toMatchObject({
    tokenId: "1",
    assetId: "asset-a",
    name: "a.glb",
  });
});

test("loadCurrentAssets discards stale results when the collection changes mid-flight", async () => {
  const { loadCurrentAssets } = await loadModule();

  libraryState.set({
    collections: [
      { id: "c1", tokenId: "1", name: "Weapons", role: "owner" },
      { id: "c2", tokenId: "2", name: "Armor", role: "owner" },
    ],
    currentCollectionTokenId: "1",
  });

  let resolveFirst;
  _expandTokenToAssets.mockImplementation((tokenId) => {
    if (String(tokenId) === "2") return Promise.resolve([]);
    return new Promise((resolve) => {
      resolveFirst = () =>
        resolve([
          {
            tokenId: "1",
            assetId: "asset-a",
            manifestCid: "bafyA",
            name: "a.glb",
            thumbnail: null,
          },
        ]);
    });
  });

  const loadPromise = loadCurrentAssets();

  // Switch to a different collection before the first request resolves.
  libraryState.set({ currentCollectionTokenId: "2" });

  resolveFirst();
  await loadPromise;
  // Wait for the second load (collection "2") to finish too.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The stale result for collection "1" must not overwrite collection "2" state.
  expect(libraryState.get().assets).toEqual([]);
  expect(libraryState.get().currentCollectionTokenId).toBe("2");
});
