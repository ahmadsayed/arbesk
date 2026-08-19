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
        <div class="library-details-rows">
          <div class="library-details-row"><span class="k">Owner</span>
            <span class="v"><span id="libraryDetailsOwner">…</span>
              <button id="libraryDetailsCopyOwner" hidden></button></span></div>
          <div class="library-details-row"><span class="k">Modified</span>
            <span id="libraryDetailsModified" class="v">—</span></div>
          <div id="libraryDetailsChildrenRow" class="library-details-row"><span class="k">Children</span>
            <span id="libraryDetailsChildren" class="v">—</span></div>
          <div class="library-details-row"><span class="k">Role</span>
            <span id="libraryDetailsRole" class="v">—</span></div>
        </div>
      </div>
      <div id="libraryDetailsEmpty">Select an item to see details</div>
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
  owner = OWNER,
  babylonFails = false,
  previewHandles = [],
} = {}) {
  jest.resetModules();

  const getFromRemoteIPFS = jest.fn(async () => manifest);
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
    expect(document.getElementById("libraryDetailsEmpty").textContent).toBe(
      "Select an item to see details"
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
    expect(document.getElementById("libraryDetailsEmpty").textContent).toBe(
      "2 items selected"
    );
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

  test("collection selection shows a thumbnail, no children row, no 3D", async () => {
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
    expect(document.getElementById("libraryDetailsChildrenRow").hidden).toBe(true);
    expect(document.getElementById("libraryDetailsRole").textContent).toBe("Editor");
    expect(createChatPreview).not.toHaveBeenCalled();
    expect(loadThumbnailInto).toHaveBeenCalledWith(
      document.getElementById("libraryDetailsPreview"),
      "bafyCollThumb",
      "Props Pack"
    );
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
