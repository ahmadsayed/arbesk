/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, describe } from "@jest/globals";
import { assetStore, _resetForTesting as resetAssetState } from "@arbesk/asset-core/domain/asset-store.js";
import { trimTokenId } from "../../frontend/src/js/utils/library-items.js";

let _tokenURIs = {};
let _manifests = {};
let _wallet = { walletAddress: "0xOwner", chainId: 31415822 };
let _ownedByChain = {};
let _sharedTokens = [];
let _libraryStateRef = null;

function makeFakeContract() {
  return {
    address: "0xContract0000000000000000000000000000000001",
    abi: [],
    read: {
      tokenURI: (args) => {
        const uri = _tokenURIs[String(args[0])];
        return uri instanceof Error
          ? Promise.reject(uri)
          : Promise.resolve(uri || "");
      },
      listTokens: () => Promise.resolve([]),
    },
  };
}

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
  _wallet = { walletAddress: "0xOwner", chainId: 31415822 };
  _ownedByChain = {};
  _sharedTokens = [];
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

  document.body.innerHTML = `
    <div id="assetLibraryBody"></div>
    <span id="galleryVisitorBadge" hidden></span>
  `;
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: _wallet.walletAddress,
          chainId: _wallet.chainId,
          contract: makeFakeContract(),
        })),
        _resetForTesting: jest.fn(),
      },
    })
  );

  // The read-only contract fallback: serves the same fake contract regardless
  // of chain (tokenURI is driven by _tokenURIs).
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/read-contract.js",
    () => ({
      __esModule: true,
      getReadableContract: jest.fn(async () => makeFakeContract()),
    })
  );

  // The indexer/shared-token backend boundary.
  await jest.unstable_mockModule(
    "../../frontend/src/js/services/api.js",
    () => ({
      __esModule: true,
      getOwnedTokens: jest.fn(async (_address, chainId) => {
        return _ownedByChain[chainId] ?? [];
      }),
      getSharedTokens: jest.fn(async () => _sharedTokens),
      unpinAssetCids: jest.fn(async () => {}),
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
    "@arbesk/asset-core/domain/asset.js",
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

  const stateMod = await import("../../frontend/src/js/state/library-state.js");
  const mod = await import("../../frontend/src/js/ui/asset-library.js");
  return { ...mod, libraryState: stateMod.libraryState };
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

describe("Gallery panel visitor mode (public profile in the studio sidebar)", () => {
  const SUBJECT = "0xccc626354a2ea985d4abdc1173597a46afc63595";
  const BASE_SEPOLIA = 84532;

  async function loadVisitorModule({
    walletAddress = null,
    subject = SUBJECT,
    subjectChainId = BASE_SEPOLIA,
    owned = ["1", "2"],
  } = {}) {
    _wallet = { walletAddress, chainId: walletAddress ? BASE_SEPOLIA : null };
    _ownedByChain = { [BASE_SEPOLIA]: owned };
    const mod = await loadModule();
    mod.libraryState.set({ subjectAddress: subject, subjectChainId });
    return mod;
  }

  beforeEach(() => {
    // loadModule is module-cached; reset any subject leaked by a prior test.
    if (_libraryStateRef) {
      _libraryStateRef.set({ subjectAddress: null, subjectChainId: null });
    }
  });

  test("anonymous + subject: loads the subject's assets, no sign-in prompt, read-only chrome", async () => {
    const { initAssetLibrary, refreshAssetLibrary, libraryState } =
      await loadVisitorModule();
    _libraryStateRef = libraryState;
    initAssetLibrary();

    await refreshAssetLibrary();

    const names = [...document.querySelectorAll(".asset-card-name")].map(
      (el) => el.textContent
    );
    expect(names).toEqual(
      expect.arrayContaining(["Asset A", "Asset B", "Asset C"])
    );
    // The sign-in empty state is gone…
    expect(document.getElementById("galleryConnectBtn")).toBeNull();
    // …replaced by the visitor badge.
    const badge = document.getElementById("galleryVisitorBadge");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("Read-only · public profile");
    // Read-only chrome: no delete, no Add to Scene, no drag.
    expect(document.querySelector(".asset-card-delete")).toBeNull();
    const actionTexts = [
      ...document.querySelectorAll(".asset-card-actions button"),
    ].map((b) => b.textContent);
    expect(actionTexts.some((t) => t.includes("Add to Scene"))).toBe(false);
    expect(actionTexts.some((t) => t.includes("Download"))).toBe(true);
    expect(document.querySelector(".asset-card").draggable).toBe(false);
    // Section is labeled for a profile, not "My Assets".
    expect(
      document.querySelector(".asset-library-section-title").textContent
    ).toBe("Public Assets");
  });

  test("subject with no assets shows the public empty state", async () => {
    const { initAssetLibrary, refreshAssetLibrary, libraryState } =
      await loadVisitorModule({ owned: [] });
    _libraryStateRef = libraryState;
    initAssetLibrary();

    await refreshAssetLibrary();

    expect(document.querySelector(".asset-card")).toBeNull();
    expect(document.querySelector(".empty-state-title").textContent).toBe(
      "No public assets yet"
    );
    expect(document.getElementById("galleryConnectBtn")).toBeNull();
  });

  test("no subject + anonymous: sign-in prompt stays untouched", async () => {
    const { initAssetLibrary, refreshAssetLibrary, libraryState } =
      await loadVisitorModule({ subject: null, subjectChainId: null });
    _libraryStateRef = libraryState;
    initAssetLibrary();
    document.getElementById("assetLibraryBody").innerHTML =
      '<div class="empty-state"><button id="galleryConnectBtn">Login / Signup</button></div>';

    await refreshAssetLibrary();

    expect(document.getElementById("galleryConnectBtn")).not.toBeNull();
    expect(document.getElementById("galleryVisitorBadge").hidden).toBe(true);
  });

  test("subject == wallet: owner mode unchanged (full chrome, no badge)", async () => {
    const { initAssetLibrary, refreshAssetLibrary, libraryState } =
      await loadVisitorModule({ walletAddress: SUBJECT });
    _libraryStateRef = libraryState;
    initAssetLibrary();

    await refreshAssetLibrary();

    const names = [...document.querySelectorAll(".asset-card-name")].map(
      (el) => el.textContent
    );
    expect(names).toEqual(
      expect.arrayContaining(["Asset A", "Asset B", "Asset C"])
    );
    expect(
      document.querySelector(".asset-card-delete").hidden
    ).toBe(false);
    const actionTexts = [
      ...document.querySelectorAll(".asset-card-actions button"),
    ].map((b) => b.textContent);
    expect(actionTexts.some((t) => t.includes("Add to Scene"))).toBe(true);
    expect(document.querySelector(".asset-card").draggable).toBe(true);
    expect(document.getElementById("galleryVisitorBadge").hidden).toBe(true);
    expect(
      document.querySelector(".asset-library-section-title").textContent
    ).toBe("My Assets");
  });
});
