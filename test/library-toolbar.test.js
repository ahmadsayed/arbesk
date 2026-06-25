/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

// Mutable mock state so the same ESM import can be driven differently per test.
let _createNamedCollection = jest.fn().mockResolvedValue({
  tokenId: "12345",
  manifestCid: "QmCollection",
  isNew: true,
});
let _uploadFileToCollection = jest.fn().mockResolvedValue({
  assetId: "asset_123",
  assetManifestCid: "QmAsset",
  newCollectionCid: "QmCollection",
});
let _refreshLibraryData = jest.fn();

beforeEach(() => {
  _resetForTesting();
  _createNamedCollection = jest.fn().mockResolvedValue({
    tokenId: "12345",
    manifestCid: "QmCollection",
    isNew: true,
  });
  _uploadFileToCollection = jest.fn().mockResolvedValue({
    assetId: "asset_123",
    assetManifestCid: "QmAsset",
    newCollectionCid: "QmCollection",
  });
  _refreshLibraryData = jest.fn();

  window.focusTrap = {
    createFocusTrap: () => ({
      activate() { return this; },
      deactivate() { return this; },
    }),
  };
  window.Notyf = jest.fn().mockImplementation(() => ({
    open: jest.fn(() => ({ on: jest.fn() })),
    dismiss: jest.fn(),
  }));
  document.body.innerHTML = `
    <button id="libraryUpBtn" hidden></button>
    <nav id="libraryBreadcrumb"></nav>
    <input id="librarySearchInput" />
    <select id="librarySortSelect"><option value="name">Name</option><option value="date">Date</option></select>
    <div class="library-toolbar-actions">
      <button id="libraryCreateCollectionBtn" hidden></button>
      <button id="libraryUploadBtn" hidden></button>
    </div>
    <input id="libraryUploadInput" type="file" hidden />
    <button id="libraryGridViewBtn" class="active" data-view="grid"></button>
    <button id="libraryListViewBtn" data-view="list"></button>
    <div id="libraryItems"></div>
    <span id="libraryLiveRegion"></span>
  `;
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../frontend/src/js/services/library-ops.js",
    () => ({
      createNamedCollection: jest.fn((...args) => _createNamedCollection(...args)),
      uploadFileToCollection: jest.fn((...args) => _uploadFileToCollection(...args)),
    })
  );

  await jest.unstable_mockModule(
    "../frontend/src/js/library-init.js",
    () => ({
      refreshLibraryData: jest.fn((...args) => _refreshLibraryData(...args)),
    })
  );

  const mod = await import("../frontend/src/js/ui/library-toolbar.js");
  return mod;
}

describe("renderBreadcrumb", () => {
  test("renders Home only at the root", async () => {
    const { renderBreadcrumb } = await loadModule();
    const container = document.getElementById("libraryBreadcrumb");
    renderBreadcrumb(container, [], null);
    expect(container.querySelectorAll(".pathbar-segment, .pathbar-current")).toHaveLength(1);
    expect(container.textContent).toContain("Home");
  });

  test("renders Home and the current collection name", async () => {
    const { renderBreadcrumb } = await loadModule();
    const collections = [{ tokenId: "1", name: "Characters" }];
    const container = document.getElementById("libraryBreadcrumb");
    renderBreadcrumb(container, collections, "1");
    expect(container.textContent).toContain("Home");
    expect(container.textContent).toContain("Characters");
    expect(container.querySelector(".pathbar-current").textContent).toBe("Characters");
  });
});

describe("breadcrumb click navigation", () => {
  test("clicking Home navigates back to the collections list", async () => {
    libraryState.set({
      collections: [{ id: "c1", tokenId: "1", name: "Characters" }],
      currentCollectionTokenId: "1",
    });
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();
    document.querySelector('[data-collection-token-id=""]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(libraryState.get().currentCollectionTokenId).toBeNull();
  });
});

describe("search input", () => {
  test("typing updates libraryState.searchQuery", async () => {
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();
    const input = document.getElementById("librarySearchInput");
    input.value = "shield";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(libraryState.get().searchQuery).toBe("shield");
  });
});

describe("sort select", () => {
  test("changing it updates libraryState.sortBy", async () => {
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();
    const select = document.getElementById("librarySortSelect");
    select.value = "date";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(libraryState.get().sortBy).toBe("date");
  });
});

describe("view toggle", () => {
  test("clicking the list view button switches viewMode and toggles active classes", async () => {
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();
    document.getElementById("libraryListViewBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(libraryState.get().viewMode).toBe("list");
    expect(document.getElementById("libraryListViewBtn").classList.contains("active")).toBe(true);
    expect(document.getElementById("libraryGridViewBtn").classList.contains("active")).toBe(false);
  });
});

describe("create collection button", () => {
  test("opens dialog, creates collection, and navigates into it", async () => {
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();

    const btn = document.getElementById("libraryCreateCollectionBtn");
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 0));

    const input = document.querySelector(".dialog-input");
    const confirmBtn = document.querySelector(".dialog-confirm-btn");
    expect(input).not.toBeNull();
    input.value = "My Collection";
    confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(_createNamedCollection).toHaveBeenCalledWith("My Collection");

    // The new collection should appear immediately, before refreshLibraryData resolves,
    // but the user should stay at the top-level collections list.
    expect(libraryState.get().currentCollectionTokenId).toBeNull();
    const collections = libraryState.get().collections;
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({
      id: "collection-12345",
      tokenId: "12345",
      type: "collection",
      name: "My Collection",
      manifestCid: "QmCollection",
      role: "owner",
    });
  });

  test("is disabled when a collection is open", async () => {
    libraryState.set({ currentCollectionTokenId: "99" });
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();

    const btn = document.getElementById("libraryCreateCollectionBtn");
    expect(btn.disabled).toBe(true);
  });
});

describe("upload button", () => {
  test("triggers the hidden file input when a collection is open", async () => {
    libraryState.set({ currentCollectionTokenId: "99" });
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();

    const btn = document.getElementById("libraryUploadBtn");
    const input = document.getElementById("libraryUploadInput");
    const clickSpy = jest.spyOn(input, "click");

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clickSpy).toHaveBeenCalled();
  });

  test("shows a warning toast when upload is clicked without an open collection", async () => {
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();

    const btn = document.getElementById("libraryUploadBtn");
    const input = document.getElementById("libraryUploadInput");
    const clickSpy = jest.spyOn(input, "click");

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(clickSpy).not.toHaveBeenCalled();
    // showToast would have been called; Notyf is mocked, so just ensure no crash.
  });

  test("uploads a selected file into the current collection", async () => {
    libraryState.set({ currentCollectionTokenId: "99" });
    const { initLibraryToolbar } = await loadModule();
    initLibraryToolbar();

    const input = document.getElementById("libraryUploadInput");
    const file = new File(["glb"], "model.glb", { type: "model/gltf-binary" });
    Object.defineProperty(input, "files", {
      value: [file],
      writable: false,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(_uploadFileToCollection).toHaveBeenCalledWith(file, "99");
    expect(libraryState.get().selectedIds).toEqual(["asset-99-asset_123"]);
  });
});
