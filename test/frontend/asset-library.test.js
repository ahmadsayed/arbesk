// @test-env dom
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { assetStore, _resetForTesting as resetAssetState } from "@arbesk/asset-core/domain/asset-store.js";
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
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

const adoptSpy = jest.fn();
const linkedSpy = jest.fn();
on(EVENTS.ASSET_ADD_LINKED_REQUESTED, (payload) => linkedSpy(payload));

const toastSpy = jest.fn();
const removeChildSpy = jest.fn();

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
  adoptSpy.mockClear();
  linkedSpy.mockClear();
  toastSpy.mockClear();
  removeChildSpy.mockClear();
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
    <h3 id="insertPanelTitle">Insert</h3>
    <p id="insertPanelHint">Insert hint</p>
    <input id="insertSearchInput" type="search" />
    <div id="insertNoAsset" hidden><button id="insertNewAssetBtn" type="button">New empty asset</button></div>
    <button id="newAssetBtn" type="button"></button>
  `;
});

async function loadModule() {
  await mock.module("../../frontend/src/js/ui/toasts.js", () => ({
    showToast: toastSpy,
    dismissToast: jest.fn(),
    dismissAllToasts: jest.fn(),
  }));
  await mock.module("../../frontend/src/js/engine/child-remove.js", () => ({
    removeChildAssetNodes: removeChildSpy,
  }));
  await mock.module(
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
  await mock.module(
    "../../frontend/src/js/blockchain/read-contract.js",
    () => ({
      __esModule: true,
      getReadableContract: jest.fn(async () => makeFakeContract()),
    })
  );

  // The indexer/shared-token backend boundary.
  await mock.module(
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

  await mock.module(
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

  await mock.module(
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
      adoptOpenedAsset: adoptSpy,
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

  test("a token whose IPFS load fails is summarised, not rendered as a card", async () => {
    const { initAssetLibrary, renderAssetLibrary } = await loadModule();
    initAssetLibrary();

    // Token 3 maps to a CID that is not in _manifests → getFromRemoteIPFS rejects
    _tokenURIs[3] = "bafyBroken";

    await renderAssetLibrary(["3"], []);

    expect(document.querySelector(".asset-card")).toBeNull();
    expect(document.querySelector(".asset-library-failed")).not.toBeNull();
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
    // The open asset's own card is hidden; it returns, updated, once closed.
    expect(document.querySelector('.asset-card[data-asset-id="asset-a"]')).toBeNull();
    assetStore.set({
      activeAssetTokenId: null,
      activeAssetId: null,
      activeAssetManifestCid: null,
      currentManifest: null,
    });
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
    // Read-only chrome: no drag, never disabled.
    expect(document.querySelector(".asset-card").draggable).toBe(false);
    expect(document.querySelector(".asset-card-main").disabled).toBe(false);
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
    // Owner cards are draggable once there is an asset to insert into.
    assetStore.set({ activeAssetManifestCid: "bafyOpen", activeAssetId: "asset-open" });

    await refreshAssetLibrary();

    const names = [...document.querySelectorAll(".asset-card-name")].map(
      (el) => el.textContent
    );
    expect(names).toEqual(
      expect.arrayContaining(["Asset A", "Asset B", "Asset C"])
    );
    expect(document.querySelector(".asset-card-more")).not.toBeNull();
    expect(document.querySelector(".asset-card").draggable).toBe(true);
    expect(document.getElementById("galleryVisitorBadge").hidden).toBe(true);
    expect(
      document.querySelector(".asset-library-section-title").textContent
    ).toBe("Your assets");
  });
});

describe("Insert panel cards", () => {
  const OPEN = { activeAssetManifestCid: "bafyOpen", activeAssetTokenId: "9", activeAssetId: "asset-open" };
  beforeEach(() => {
    if (_libraryStateRef) _libraryStateRef.set({ subjectAddress: null, subjectChainId: null });
  });
  const waitFor = async (fn) => {
    for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  };

  async function renderOwned(owned = ["1", "2"], shared = []) {
    const mod = await loadModule();
    mod.initAssetLibrary();
    await mod.renderAssetLibrary(owned, shared);
    return mod;
  }
  const cardNamed = (name) =>
    [...document.querySelectorAll(".asset-card")].find(
      (c) => c.querySelector(".asset-card-name").textContent === name
    );

  async function loadVisitorModuleForChrome() {
    _wallet = { walletAddress: null, chainId: null };
    _ownedByChain = { 84532: ["1", "2"] };
    const mod = await loadModule();
    mod.libraryState.set({ subjectAddress: "0xccc626354a2ea985d4abdc1173597a46afc63595", subjectChainId: 84532 });
    _libraryStateRef = mod.libraryState;
    mod.initAssetLibrary();
    return mod;
  }

  test("card click emits ASSET_ADD_LINKED_REQUESTED with mode live-ref", async () => {
    assetStore.set(OPEN);
    await renderOwned();
    const main = cardNamed("Asset A").querySelector(".asset-card-main");
    expect(main.getAttribute("aria-label")).toBe("Insert Asset A");
    main.click();
    expect(linkedSpy).toHaveBeenCalledTimes(1);
    const payload = linkedSpy.mock.calls[0][0];
    expect(payload.mode).toBe("live-ref");
    expect(payload.token_id).toBe("1");
    expect(payload.assetID).toBe("asset-a");
  });

  test("Insert a copy emits mode fork", async () => {
    assetStore.set(OPEN);
    await renderOwned();
    const card = cardNamed("Asset A");
    const more = card.querySelector(".asset-card-more");
    expect(more.getAttribute("aria-label")).toBe("More actions for Asset A");
    more.click();
    const items = [...card.querySelectorAll(".menu-popover [role=menuitem]")];
    expect(items.map((i) => i.textContent)).toEqual([
      "Insert a copy",
      "Open Asset A",
      "Show in Library",
    ]);
    card.querySelector('[data-action="insert-copy"]').click();
    expect(linkedSpy).toHaveBeenCalledTimes(1);
    expect(linkedSpy.mock.calls[0][0].mode).toBe("fork");
  });

  test("Open item opens the asset", async () => {
    assetStore.set(OPEN);
    await renderOwned();
    const card = cardNamed("Asset A");
    card.querySelector(".asset-card-more").click();
    card.querySelector('[data-action="open"]').click();
    await waitFor(() => adoptSpy.mock.calls.length > 0);
    expect(adoptSpy).toHaveBeenCalledTimes(1);
    expect(adoptSpy.mock.calls[0][0]).toBe("bafyA");
    expect(linkedSpy).not.toHaveBeenCalled();
  });

  test("cards have no Download, Delete, Burn or role badge", async () => {
    _tokenURIs[3] = "bafyBroken";
    await renderOwned(["1", "3"], ["2"]);
    expect(document.querySelector(".asset-card-actions")).toBeNull();
    expect(document.querySelector(".asset-card-badge")).toBeNull();
    expect(document.querySelector(".asset-card--inaccessible")).toBeNull();
  });

  test("sections are 'Your assets' and 'Shared with you'", async () => {
    await renderOwned(["1"], ["2"]);
    const titles = [...document.querySelectorAll(".asset-library-section-title")].map(
      (h) => h.textContent
    );
    expect(titles).toEqual(["Your assets", "Shared with you"]);
  });

  test("failed tokens render one summary line linking to /library", async () => {
    _tokenURIs[3] = "bafyBroken";
    await renderOwned(["1", "3"]);
    const failed = document.querySelectorAll(".asset-library-failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].textContent).toBe("1 asset can't be loaded. Manage in Library");
    expect(failed[0].querySelector("a").getAttribute("href")).toBe("/library");

    _tokenURIs[4] = "bafyBroken";
    await renderOwned(["3", "4"]);
    expect(document.querySelector(".asset-library-failed").textContent).toContain(
      "2 assets can't be loaded."
    );
  });

  test("the open asset's own card is hidden", async () => {
    assetStore.set({ activeAssetId: "asset-b", activeCollectionTokenId: null });
    await renderOwned(["2"]);
    expect(cardNamed("Asset B")).toBeUndefined();
    expect(cardNamed("Asset C")).toBeDefined();
  });

  test("with no asset open cards are disabled and emit nothing", async () => {
    await renderOwned();
    const main = cardNamed("Asset A").querySelector(".asset-card-main");
    expect(main.disabled).toBe(true);
    main.click();
    expect(linkedSpy).not.toHaveBeenCalled();
    expect(adoptSpy).not.toHaveBeenCalled();
  });

  test("cards enable when an asset opens, without refetching", async () => {
    await renderOwned();
    const main = cardNamed("Asset A").querySelector(".asset-card-main");
    expect(main.disabled).toBe(true);
    assetStore.set(OPEN);
    expect(cardNamed("Asset A").querySelector(".asset-card-main").disabled).toBe(false);
  });

  test("visitor mode: title Browse, hint read-only, click opens, menu has only Show in Library", async () => {
    const mod = await loadVisitorModuleForChrome();
    await mod.refreshAssetLibrary();
    expect(document.getElementById("insertPanelTitle").textContent).toBe("Browse");
    expect(document.getElementById("insertPanelHint").textContent).toBe(
      "Read-only public profile. Open an asset to view it."
    );
    expect(document.getElementById("insertNoAsset").hidden).toBe(true);
    const card = cardNamed("Asset A");
    card.querySelector(".asset-card-more").click();
    const items = [...card.querySelectorAll(".menu-popover [role=menuitem]")];
    expect(items.map((i) => i.textContent)).toEqual(["Show in Library"]);
    card.querySelector(".asset-card-main").click();
    await waitFor(() => adoptSpy.mock.calls.length > 0);
    expect(adoptSpy).toHaveBeenCalledTimes(1);
    expect(linkedSpy).not.toHaveBeenCalled();
  });

  test("search filters cards by name, case-insensitive", async () => {
    assetStore.set(OPEN);
    await renderOwned();
    const input = document.getElementById("insertSearchInput");
    input.value = "asset b";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const visible = [...document.querySelectorAll(".asset-card")].filter((c) => !c.hidden);
    expect(visible.map((c) => c.querySelector(".asset-card-name").textContent)).toEqual(["Asset B"]);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect([...document.querySelectorAll(".asset-card")].filter((c) => !c.hidden).length).toBe(3);
  });

  test("no asset open shows the notice; New empty asset clicks #newAssetBtn", async () => {
    await renderOwned();
    const notice = document.getElementById("insertNoAsset");
    expect(notice.hidden).toBe(false);
    const clicked = jest.fn();
    document.getElementById("newAssetBtn").addEventListener("click", clicked);
    document.getElementById("insertNewAssetBtn").click();
    expect(clicked).toHaveBeenCalledTimes(1);
    assetStore.set(OPEN);
    expect(document.getElementById("insertNoAsset").hidden).toBe(true);
  });

  test("insert failure shows an error toast with the reason and no Undo", async () => {
    await renderOwned();
    emit(EVENTS.ASSET_LINKED_INSERT_FAILED, { assetID: "asset-a", reason: "Too deep" });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const arg = toastSpy.mock.calls[0][0];
    expect(arg.type).toBe("error");
    expect(arg.title).toBe("Couldn't insert Asset A");
    expect(arg.message).toBe("Too deep");
    expect(arg.actions).toBeUndefined();
  });

  test("insert toast names asset and target, Undo unlinks that node", async () => {
    assetStore.set({ ...OPEN, activeAssetName: "Chair" });
    await renderOwned();
    emit(EVENTS.ASSET_LINKED_INSERTED, { nodeId: "n1", assetID: "asset-a", mode: "live-ref" });
    const arg = toastSpy.mock.calls[0][0];
    expect(arg.title).toBe("Asset A inserted into Chair");
    expect(arg.actions.map((a) => a.label)).toEqual(["Undo"]);
    arg.actions[0].onClick();
    expect(removeChildSpy).toHaveBeenCalledWith(["n1"]);
  });

  test("a named empty draft accepts inserts: cards enabled, notice hidden", async () => {
    assetStore.set({ activeAssetName: "Chair" });
    await renderOwned();
    const card = cardNamed("Asset A");
    expect(card.querySelector(".asset-card-main").disabled).toBe(false);
    expect(document.getElementById("insertNoAsset").hidden).toBe(true);
    card.querySelector(".asset-card-main").click();
    expect(linkedSpy).toHaveBeenCalledTimes(1);
  });

  test("New empty asset enables the cards once the draft is named", async () => {
    await renderOwned();
    document.getElementById("newAssetBtn").addEventListener("click", () => {
      assetStore.set({ activeAssetName: "Untitled Asset" });
    });
    document.getElementById("insertNewAssetBtn").click();
    expect(cardNamed("Asset A").querySelector(".asset-card-main").disabled).toBe(false);
    expect(document.getElementById("insertNoAsset").hidden).toBe(true);
  });

  test("disabled cards are not draggable and opt out of hover", async () => {
    await renderOwned();
    const card = cardNamed("Asset A");
    expect(card.draggable).toBe(false);
    expect(card.classList.contains("asset-card--disabled")).toBe(true);
    const ev = new Event("dragstart", { cancelable: true });
    ev.dataTransfer = { setData: jest.fn(), effectAllowed: "" };
    card.dispatchEvent(ev);
    expect(ev.dataTransfer.setData).not.toHaveBeenCalled();
    assetStore.set(OPEN);
    const enabled = cardNamed("Asset A");
    expect(enabled.draggable).toBe(true);
    expect(enabled.classList.contains("asset-card--disabled")).toBe(false);
  });

  test("the no-asset notice is right before the first render", async () => {
    const { initAssetLibrary } = await loadModule();
    initAssetLibrary();
    expect(document.getElementById("insertNoAsset").hidden).toBe(false);
    assetStore.set(OPEN);
    expect(document.getElementById("insertNoAsset").hidden).toBe(true);
  });
});
