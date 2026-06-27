/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, describe } from "@jest/globals";
import { assetState, _resetForTesting as resetAssetState } from "../../frontend/src/js/state/asset-state.js";

let _tokenURIs = {};
let _manifests = {};

beforeEach(() => {
  resetAssetState();
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
                call: jest.fn().mockResolvedValue(_tokenURIs[tokenId] || ""),
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
      clearRemoteIPFSCache: jest.fn(),
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

    assetState.set({ activeCollectionTokenId: "2" });
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
    assetState.set({ activeCollectionTokenId: "2" });
    await renderAssetLibrary(["1", "2"], []);

    expect(document.querySelector(".asset-card")).toBeNull();
    expect(document.querySelector(".empty-state")).not.toBeNull();
  });
});
