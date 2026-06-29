/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeEach, afterEach } from "@jest/globals";
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

let _createNamedCollection = jest.fn().mockResolvedValue({
  tokenId: "12345",
  manifestCid: "bafyCollection",
  isNew: true,
});
let _refreshLibraryData = jest.fn();

beforeEach(() => {
  _resetForTesting();
  _createNamedCollection = jest.fn().mockResolvedValue({
    tokenId: "12345",
    manifestCid: "bafyCollection",
    isNew: true,
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
    <div id="libraryItems"></div>
    <div id="libraryLiveRegion"></div>
  `;
});

afterEach(() => {
  document.body.innerHTML = "";
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../frontend/src/js/services/library-ops.js",
    () => ({
      createNamedCollection: jest.fn((...args) => _createNamedCollection(...args)),
    })
  );

  await jest.unstable_mockModule(
    "../frontend/src/js/library-init.js",
    () => ({
      refreshLibraryData: jest.fn((...args) => _refreshLibraryData(...args)),
    })
  );

  const mod = await import("../frontend/src/js/ui/library-context-menu.js");
  return mod;
}

test("context-menu New Collection stays at the collections list level", async () => {
  const { openContextMenu, closeContextMenu } = await loadModule();

  openContextMenu(0, 0, []);
  const newCollectionItem = [...document.querySelectorAll(".context-menu-item")]
    .find((el) => el.textContent.trim() === "New Collection");
  expect(newCollectionItem).not.toBeUndefined();

  newCollectionItem.click();
  closeContextMenu();
  await new Promise((r) => setTimeout(r, 0));

  const input = document.querySelector(".dialog-input");
  const confirmBtn = document.querySelector(".dialog-confirm-btn");
  expect(input).not.toBeNull();
  input.value = "My Collection";
  confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  expect(_createNamedCollection).toHaveBeenCalledWith("My Collection");
  expect(_refreshLibraryData).toHaveBeenCalled();

  // The new collection should appear immediately, but the UI stays at the
  // collections list level rather than navigating into the new collection.
  expect(libraryState.get().currentCollectionTokenId).toBeNull();
  const collections = libraryState.get().collections;
  expect(collections).toHaveLength(1);
  expect(collections[0]).toMatchObject({
    id: "collection-12345",
    tokenId: "12345",
    type: "collection",
    name: "My Collection",
    manifestCid: "bafyCollection",
    role: "owner",
  });
});
