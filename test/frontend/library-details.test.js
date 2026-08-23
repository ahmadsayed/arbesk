/**
 * @jest-environment jsdom
 *
 * Library details pane (ui/library-details.ts): selection-driven metadata
 * rows, empty/multi states, owner truncation + cache, 3D preview lifecycle,
 * and the static-thumbnail fallbacks. IPFS, the contract, Babylon, and the
 * chat-preview service are all mocked — no network, no WebGL.
 */
import { jest, expect, test, describe, beforeEach } from "@jest/globals";

const OWNER = `0x8f3C${"0".repeat(30)}9b2E`;
const MODIFIED = new Date(2026, 7, 17, 12).getTime(); // Aug 17, 2026, local noon

const MANIFEST = {
  name: "Robot Scout",
  timestamp: MODIFIED,
  scene: {
    nodes: [
      { node_id: "root", source: { cid: "bafySrc", path: "model.glb", format: "glb" } },
      { node_id: "child", source: null },
    ],
  },
};

const ASSET = {
  id: "asset-7-root",
  type: "asset",
  tokenId: "7",
  assetId: "root",
  manifestCid: "bafyManifest",
  name: "Robot Scout",
  thumbnailCid: "bafyThumb",
  status: "besked",
  role: "owner",
};

const COLLECTION = {
  id: "collection-9",
  type: "collection",
  tokenId: "9",
  manifestCid: "bafyCollection",
  name: "Props Pack",
  thumbnailCid: "bafyCollThumb",
  status: "besked",
  role: "editor",
};

function buildDom() {
  document.body.innerHTML = `
    <div id="libraryView"></div>
    <button id="libraryDetailsToggleBtn" class="active" aria-pressed="true"></button>
    <aside id="libraryDetails" class="library-details" data-state="empty">
      <div id="libraryDetailsPreview" hidden>
        <span id="libraryDetailsOrbitHint" hidden>drag to orbit</span>
      </div>
      <div id="libraryDetailsBody">
        <div id="libraryDetailsTitle"></div>
        <span id="libraryDetailsBadge"></span>
        <div class="library-details-actions">
          <button id="libraryDetailsOpenBtn"></button>
        </div>
        <div class="library-details-rows">
          <div class="library-details-row"><span class="k">Version</span>
            <span class="v"><span id="libraryDetailsVersion">—</span></span></div>
          <div class="library-details-row"><span class="k">Current</span>
            <span class="v"><span id="libraryDetailsCid">…</span>
              <button id="libraryDetailsCopyCid" hidden></button></span></div>
          <div class="library-details-row"><span class="k">Editors</span>
            <span id="libraryDetailsEditors" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Modified</span>
            <span id="libraryDetailsModified" class="v">—</span></div>
        </div>
        <button id="libraryDetailsMoreBtn" aria-expanded="false"></button>
        <div id="libraryDetailsExtra" class="library-details-rows" hidden>
          <div id="libraryDetailsChildrenRow" class="library-details-row">
            <span id="libraryDetailsChildrenLabel" class="k">Children</span>
            <span id="libraryDetailsChildren" class="v">—</span></div>
          <div id="libraryDetailsFormatRow" class="library-details-row"><span class="k">Format</span>
            <span id="libraryDetailsFormat" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Anchor</span>
            <span id="libraryDetailsAnchor" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Owner</span>
            <span class="v"><span id="libraryDetailsOwner">…</span>
              <button id="libraryDetailsCopyOwner" hidden></button></span></div>
          <div class="library-details-row"><span class="k">Role</span>
            <span id="libraryDetailsRole" class="v">—</span></div>
        </div>
      </div>
      <div id="libraryDetailsEmpty">
        <div id="libraryDetailsEmptyTitle"></div>
        <span id="libraryDetailsEmptyBadge"></span>
        <div class="library-details-rows">
          <div class="library-details-row">
            <span id="libraryDetailsEmptyLabel" class="k"></span>
            <span id="libraryDetailsEmptyCount" class="v"></span>
          </div>
        </div>
        <p class="library-details-hint">
          <span id="libraryDetailsEmptyHint"></span>
        </p>
        <p id="libraryDetailsEmptyPrompt"></p>
      </div>
    </aside>
  `;
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Fresh module registry per call so the library-state store and the event
 * bus do not leak between tests.
 */
async function load({
  manifest = MANIFEST,
  manifests = null,
  owner = OWNER,
  babylonFails = false,
  previewHandles = [],
  editors = [],
} = {}) {
  jest.resetModules();

  const getFromRemoteIPFS = jest.fn(async (cid) =>
    manifests && manifests[cid] ? manifests[cid] : manifest
  );
  const ownerOfCall = jest.fn(async () => owner);
  const getActiveContract = jest.fn(() => ({
    methods: { ownerOf: () => ({ call: ownerOfCall }) },
  }));
  const ensureBabylon = jest.fn(async () => {
    if (babylonFails) throw new Error("no babylon");
  });
  const handles = [...previewHandles];
  const createChatPreview = jest.fn(async () =>
    handles.length ? handles.shift() : null
  );
  const loadThumbnailInto = jest.fn(async (containerEl) => {
    const img = document.createElement("img");
    containerEl.textContent = "";
    containerEl.appendChild(img);
    return img;
  });
  const extractThumbnailCid = (thumbnail) => {
    if (!thumbnail) return null;
    if (typeof thumbnail === "string") return thumbnail;
    return thumbnail.cid || thumbnail.source?.cid || null;
  };
  const loadEditorList = jest.fn(async () => editors);
  const openItem = jest.fn();

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    __esModule: true,
    getFromRemoteIPFS,
  }));
  jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
    __esModule: true,
    getActiveContract,
  }));
  jest.unstable_mockModule("../../frontend/src/js/engine/babylon-loader.js", () => ({
    __esModule: true,
    ensureBabylon,
  }));
  jest.unstable_mockModule("../../frontend/src/js/services/chat-preview.js", () => ({
    __esModule: true,
    createChatPreview,
  }));
  jest.unstable_mockModule("../../frontend/src/js/utils/thumbnail.js", () => ({
    __esModule: true,
    loadThumbnailInto,
    extractThumbnailCid,
  }));
  jest.unstable_mockModule("../../frontend/src/js/domain/editors.js", () => ({
    __esModule: true,
    loadEditorList,
  }));
  jest.unstable_mockModule("../../frontend/src/js/ui/library-grid.js", () => ({
    __esModule: true,
    openItem,
  }));

  const { libraryState } = await import(
    "../../frontend/src/js/state/library-state.js"
  );
  const mod = await import("../../frontend/src/js/ui/library-details.js");
  return {
    libraryState,
    initLibraryDetails: mod.initLibraryDetails,
    getFromRemoteIPFS,
    ownerOfCall,
    ensureBabylon,
    createChatPreview,
    loadThumbnailInto,
    loadEditorList,
    openItem,
  };
}

function makeHandle(id = "library-details") {
  return { id, dispose: jest.fn(async () => null) };
}

beforeEach(() => {
  localStorage.clear();
  buildDom();
});

describe("library-details pane", () => {
  test("shows the empty state with no selection", async () => {
    const { initLibraryDetails } = await load();
    initLibraryDetails();
    await flush();

    const pane = document.getElementById("libraryDetails");
    expect(pane.dataset.state).toBe("empty");
    expect(
      document.getElementById("libraryDetailsEmptyPrompt").textContent
    ).toBe("Select an item to see details");
  });

  test("empty state at Home shows the collection count and upload hint", async () => {
    const { libraryState, initLibraryDetails } = await load();
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION, { ...COLLECTION, id: "collection-10" }],
      selectedIds: [],
    });
    await flush();

    expect(
      document.getElementById("libraryDetailsEmptyTitle").textContent
    ).toBe("Home");
    expect(
      document.getElementById("libraryDetailsEmptyBadge").textContent
    ).toBe("Overview");
    expect(document.getElementById("libraryDetailsEmptyLabel").textContent).toBe(
      "Collections"
    );
    expect(document.getElementById("libraryDetailsEmptyCount").textContent).toBe(
      "2"
    );
    expect(document.getElementById("libraryDetailsEmptyHint").textContent).toBe(
      "Open a collection to upload .glb, .gltf or .3mf files"
    );
  });

  test("empty state inside a collection shows its name, asset count, drop hint", async () => {
    const { libraryState, initLibraryDetails } = await load();
    initLibraryDetails();
    libraryState.set({
      collections: [{ ...COLLECTION, tokenId: "7", name: "Props Pack" }],
      assets: [ASSET],
      currentCollectionTokenId: "7",
      selectedIds: [],
    });
    await flush();

    expect(
      document.getElementById("libraryDetailsEmptyTitle").textContent
    ).toBe("Props Pack");
    expect(document.getElementById("libraryDetailsEmptyLabel").textContent).toBe(
      "Assets"
    );
    expect(document.getElementById("libraryDetailsEmptyCount").textContent).toBe(
      "1"
    );
    expect(document.getElementById("libraryDetailsEmptyHint").textContent).toBe(
      "Drop .glb, .gltf or .3mf files anywhere to upload"
    );
  });

  test("shows the multi-select state with several selections", async () => {
    const { libraryState, initLibraryDetails } = await load();
    initLibraryDetails();
    libraryState.set({
      assets: [ASSET],
      collections: [COLLECTION],
      selectedIds: [ASSET.id, COLLECTION.id],
    });
    await flush();

    const pane = document.getElementById("libraryDetails");
    expect(pane.dataset.state).toBe("multi");
    expect(
      document.getElementById("libraryDetailsEmptyTitle").textContent
    ).toBe("Selection");
    expect(document.getElementById("libraryDetailsEmptyLabel").textContent).toBe(
      "Selected"
    );
    expect(document.getElementById("libraryDetailsEmptyCount").textContent).toBe(
      "2"
    );
    expect(
      document.getElementById("libraryDetailsEmptyPrompt").textContent
    ).toBe("Select a single item to see details");
  });

  test("renders the metadata rows for a selected asset", async () => {
    const handle = makeHandle();
    const { libraryState, initLibraryDetails, createChatPreview, ownerOfCall } =
      await load({ previewHandles: [handle] });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    const pane = document.getElementById("libraryDetails");
    expect(pane.dataset.state).toBe("asset");
    expect(document.getElementById("libraryDetailsTitle").textContent).toBe(
      "Robot Scout"
    );
    expect(document.getElementById("libraryDetailsBadge").textContent).toBe(
      "Asset"
    );
    expect(document.getElementById("libraryDetailsOwner").textContent).toBe(
      "0x8f3C…9b2E"
    );
    expect(document.getElementById("libraryDetailsCopyOwner").hidden).toBe(false);
    expect(document.getElementById("libraryDetailsModified").textContent).toBe(
      "Aug 17, 2026"
    );
    expect(document.getElementById("libraryDetailsChildren").textContent).toBe(
      "2 nodes"
    );
    expect(document.getElementById("libraryDetailsChildrenRow").hidden).toBe(false);
    expect(document.getElementById("libraryDetailsRole").textContent).toBe("Owner");

    // 3D preview created through the chat-preview service.
    expect(createChatPreview).toHaveBeenCalledTimes(1);
    const [id, canvas, src] = createChatPreview.mock.calls[0];
    expect(id).toBe("library-details");
    expect(canvas.tagName).toBe("CANVAS");
    expect(src).toMatchObject({
      cid: "bafySrc",
      path: "model.glb",
      format: "glb",
    });
    expect(
      document.getElementById("libraryDetailsPreview").contains(canvas)
    ).toBe(true);
    expect(document.getElementById("libraryDetailsOrbitHint").hidden).toBe(false);
    expect(ownerOfCall).toHaveBeenCalledTimes(1);
  });

  test("shows the CDP email when the owner is the connected smart account", async () => {
    const handle = makeHandle();
    const { libraryState, initLibraryDetails } = await load({
      previewHandles: [handle],
    });
    const { walletState } = await import(
      "../../frontend/src/js/state/wallet-state.js"
    );
    walletState.set({
      walletSource: "cdp",
      walletAddress: OWNER,
      email: "ada@example.com",
    });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    const ownerEl = document.getElementById("libraryDetailsOwner");
    expect(ownerEl.textContent).toBe("ada@example.com");
    // Full address stays one hover away; copy still copies the address.
    expect(ownerEl.title).toBe(OWNER);
    expect(document.getElementById("libraryDetailsCopyOwner").hidden).toBe(false);
  });

  test("shows a truncated address for non-CDP or non-self owners", async () => {
    const handle = makeHandle();
    const { libraryState, initLibraryDetails } = await load({
      previewHandles: [handle],
    });
    const { walletState } = await import(
      "../../frontend/src/js/state/wallet-state.js"
    );
    // CDP session, but the token belongs to someone else.
    walletState.set({
      walletSource: "cdp",
      walletAddress: `0x${"1".repeat(40)}`,
      email: "ada@example.com",
    });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    expect(document.getElementById("libraryDetailsOwner").textContent).toBe(
      "0x8f3C…9b2E"
    );
  });

  test("caches ownerOf per token id across re-selection", async () => {
    const handle = makeHandle();
    const { libraryState, initLibraryDetails, ownerOfCall } = await load({
      previewHandles: [handle, makeHandle(), makeHandle()],
    });
    initLibraryDetails();

    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();
    libraryState.set({ selectedIds: [] });
    libraryState.set({ selectedIds: [ASSET.id] });
    await flush();

    expect(ownerOfCall).toHaveBeenCalledTimes(1);
    expect(document.getElementById("libraryDetailsOwner").textContent).toBe(
      "0x8f3C…9b2E"
    );
  });

  test("disposes the previous preview when the selection changes", async () => {
    const handleA = makeHandle();
    const handleB = makeHandle();
    const { libraryState, initLibraryDetails, createChatPreview } = await load({
      previewHandles: [handleA, handleB],
    });
    initLibraryDetails();

    const assetB = { ...ASSET, id: "asset-8-root", tokenId: "8", name: "Castle" };
    libraryState.set({
      assets: [ASSET, assetB],
      selectedIds: [ASSET.id],
    });
    await flush();
    expect(createChatPreview).toHaveBeenCalledTimes(1);

    libraryState.set({ selectedIds: [assetB.id] });
    await flush();

    expect(handleA.dispose).toHaveBeenCalledTimes(1);
    expect(createChatPreview).toHaveBeenCalledTimes(2);
    expect(handleB.dispose).not.toHaveBeenCalled();

    // Deselecting also disposes the live preview.
    libraryState.set({ selectedIds: [] });
    await flush();
    expect(handleB.dispose).toHaveBeenCalledTimes(1);
  });

  test("falls back to the static thumbnail when Babylon is unavailable", async () => {
    const { libraryState, initLibraryDetails, createChatPreview, loadThumbnailInto } =
      await load({ babylonFails: true });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    expect(createChatPreview).not.toHaveBeenCalled();
    expect(loadThumbnailInto).toHaveBeenCalledTimes(1);
    expect(loadThumbnailInto.mock.calls[0][1]).toBe("bafyThumb");
    const preview = document.getElementById("libraryDetailsPreview");
    expect(preview.hidden).toBe(false);
    expect(preview.querySelector("img")).not.toBeNull();
  });

  test("collection selection shows the mosaic hint, asset count, no 3D", async () => {
    const { libraryState, initLibraryDetails, createChatPreview, loadThumbnailInto } =
      await load();
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    const pane = document.getElementById("libraryDetails");
    expect(pane.dataset.state).toBe("collection");
    expect(document.getElementById("libraryDetailsBadge").textContent).toBe(
      "Collection"
    );
    expect(
      document.getElementById("libraryDetailsChildrenLabel").textContent
    ).toBe("Assets");
    expect(document.getElementById("libraryDetailsChildren").textContent).toBe(
      "0 assets"
    );
    expect(document.getElementById("libraryDetailsFormatRow").hidden).toBe(true);
    expect(document.getElementById("libraryDetailsRole").textContent).toBe("Editor");
    expect(createChatPreview).not.toHaveBeenCalled();
    // No assets in the manifest → upload hint instead of thumbnails.
    expect(loadThumbnailInto).not.toHaveBeenCalled();
    const preview = document.getElementById("libraryDetailsPreview");
    expect(preview.hidden).toBe(false);
    expect(
      preview.querySelector(".library-details-mosaic-empty").textContent
    ).toContain("Empty collection");
  });

  test("collection with assets shows a thumbnail mosaic with overflow tile", async () => {
    const collectionManifest = {
      timestamp: MODIFIED,
      assets: { a1: "bafyA1", a2: "bafyA2", a3: "bafyA3", a4: "bafyA4", a5: "bafyA5" },
    };
    const manifests = {
      bafyCollection: collectionManifest,
      bafyA1: { thumbnail: "bafyT1" },
      bafyA2: { thumbnail: { cid: "bafyT2" } },
      bafyA3: { thumbnail: "bafyT3" },
      bafyA4: { thumbnail: "bafyT4" },
    };
    const { libraryState, initLibraryDetails, loadThumbnailInto } = await load({
      manifests,
    });
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    expect(document.getElementById("libraryDetailsChildren").textContent).toBe(
      "5 assets"
    );
    const mosaic = document
      .getElementById("libraryDetailsPreview")
      .querySelector(".library-details-mosaic");
    expect(mosaic).not.toBeNull();
    // 4 thumbnail tiles + 1 "+1" overflow tile.
    expect(loadThumbnailInto).toHaveBeenCalledTimes(4);
    expect(mosaic.querySelectorAll("img").length).toBe(4);
    expect(
      mosaic.querySelector(".library-details-mosaic-more").textContent
    ).toBe("+1");
  });

  test("collection falls back to its static thumbnail when assets have none", async () => {
    const manifests = {
      bafyCollection: { timestamp: MODIFIED, assets: { a1: "bafyA1" } },
      bafyA1: { name: "no thumb here" },
    };
    const { libraryState, initLibraryDetails, loadThumbnailInto } = await load({
      manifests,
    });
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    expect(loadThumbnailInto).toHaveBeenCalledTimes(1);
    expect(loadThumbnailInto).toHaveBeenCalledWith(
      document.getElementById("libraryDetailsPreview"),
      "bafyCollThumb",
      "Props Pack"
    );
  });

  test("fills version, CID, editors, and anchor rows", async () => {
    const { libraryState, initLibraryDetails } = await load({
      editors: [{ address: "0x1" }, { address: "0x2" }, { address: "0x3" }],
    });
    const { walletState } = await import(
      "../../frontend/src/js/state/wallet-state.js"
    );
    walletState.set({ chainId: 84532 });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    // MANIFEST has no prev_manifest_cid → v1.
    expect(document.getElementById("libraryDetailsVersion").textContent).toBe("v1");
    // Short CIDs stay untruncated; full value on hover + copy.
    expect(document.getElementById("libraryDetailsCid").textContent).toBe(
      "bafyManifest"
    );
    expect(document.getElementById("libraryDetailsCid").title).toBe("bafyManifest");
    expect(document.getElementById("libraryDetailsCopyCid").hidden).toBe(false);
    expect(document.getElementById("libraryDetailsEditors").textContent).toBe(
      "3 editors"
    );
    expect(document.getElementById("libraryDetailsAnchor").textContent).toBe(
      "#7 · Base Sepolia"
    );
    expect(document.getElementById("libraryDetailsFormat").textContent).toBe("GLB");
  });

  test("version walk follows prev_manifest_cid links", async () => {
    const manifests = {
      bafyManifest: { ...MANIFEST, prev_manifest_cid: "bafyPrev1" },
      bafyPrev1: { timestamp: MODIFIED - 1000, prev_manifest_cid: "bafyPrev2" },
      bafyPrev2: { timestamp: MODIFIED - 2000 },
    };
    const { libraryState, initLibraryDetails } = await load({ manifests });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    expect(document.getElementById("libraryDetailsVersion").textContent).toBe("v3");
  });

  test("editors row reads 'just you' for an empty editor list", async () => {
    const { libraryState, initLibraryDetails } = await load();
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    expect(document.getElementById("libraryDetailsEditors").textContent).toBe(
      "just you"
    );
  });

  test("More details disclosure toggles the extra rows", async () => {
    const handle = makeHandle();
    const { libraryState, initLibraryDetails } = await load({
      previewHandles: [handle],
    });
    initLibraryDetails();
    libraryState.set({ assets: [ASSET], selectedIds: [ASSET.id] });
    await flush();

    const extra = document.getElementById("libraryDetailsExtra");
    const btn = document.getElementById("libraryDetailsMoreBtn");
    expect(extra.hidden).toBe(true);
    btn.click();
    expect(extra.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click();
    expect(extra.hidden).toBe(true);
  });

  test("Open button delegates to openItem with the current item", async () => {
    const { libraryState, initLibraryDetails, openItem } = await load();
    initLibraryDetails();
    libraryState.set({
      collections: [COLLECTION],
      selectedIds: [COLLECTION.id],
    });
    await flush();

    document.getElementById("libraryDetailsOpenBtn").click();
    expect(openItem).toHaveBeenCalledWith(COLLECTION.id);
  });

  test("toggle button hides the pane and persists the choice", async () => {
    const { initLibraryDetails } = await load();
    initLibraryDetails();
    const pane = document.getElementById("libraryDetails");
    const btn = document.getElementById("libraryDetailsToggleBtn");

    expect(pane.classList.contains("hidden")).toBe(false); // default visible
    btn.click();
    expect(pane.classList.contains("hidden")).toBe(true);
    expect(localStorage.getItem("libraryDetailsVisible")).toBe("false");
    btn.click();
    expect(pane.classList.contains("hidden")).toBe(false);
    expect(localStorage.getItem("libraryDetailsVisible")).toBe("true");
  });

  test("discards stale manifest results after a rapid selection change", async () => {
    // Slow manifest for the first selection; instant for the second.
    const { libraryState, initLibraryDetails, getFromRemoteIPFS } = await load();
    let resolveFirst;
    getFromRemoteIPFS.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );
    initLibraryDetails();

    const assetB = { ...ASSET, id: "asset-8-root", tokenId: "8", name: "Castle" };
    libraryState.set({ assets: [ASSET, assetB], selectedIds: [ASSET.id] });
    await flush(2);
    libraryState.set({ selectedIds: [assetB.id] });
    // First manifest arrives after the selection already moved on.
    resolveFirst({ ...MANIFEST, timestamp: 0 });
    await flush();

    expect(document.getElementById("libraryDetailsTitle").textContent).toBe(
      "Castle"
    );
    expect(document.getElementById("libraryDetailsModified").textContent).toBe(
      "Aug 17, 2026"
    );
  });
});
