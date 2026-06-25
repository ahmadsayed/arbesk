/**
 * @jest-environment jsdom
 */
import {
  openContextMenu,
  closeContextMenu,
  requestRename,
  requestDeleteSelected,
  initLibraryContextMenu,
} from "../frontend/src/js/ui/library-context-menu.js";
import {
  libraryState,
  _resetForTesting,
} from "../frontend/src/js/state/library-state.js";

beforeEach(() => {
  _resetForTesting();
  window.focusTrap = {
    createFocusTrap: () => ({
      activate() {
        return this;
      },
      deactivate() {
        return this;
      },
    }),
  };
  document.body.innerHTML = `
    <div id="libraryItems">
      <div class="library-item" data-id="asset-1-asset-a" data-type="asset"></div>
      <div class="library-item" data-id="collection-1" data-type="collection"></div>
    </div>
    <div id="libraryLiveRegion"></div>
  `;
  libraryState.set({
    collections: [{ id: "collection-1", tokenId: "1", name: "Weapons", status: "besked" }],
    assets: [{
      id: "asset-1-asset-a",
      type: "asset",
      tokenId: "1",
      assetId: "asset-a",
      name: "a.glb",
      status: "besked",
      manifestCid: "QmA",
    }],
  });
});

afterEach(() => closeContextMenu());

function menuEl() {
  return document.querySelector(".context-menu");
}

describe("openContextMenu / closeContextMenu", () => {
  test("renders a menu positioned at the given coordinates", () => {
    openContextMenu(120, 80, ["asset-1-asset-a"]);
    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("80px");
  });

  test("a single selected asset shows Open in Studio, Send to Collection, Rename, Delete", () => {
    openContextMenu(0, 0, ["asset-1-asset-a"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual([
      "Open in Studio",
      "Send to Collection…",
      "Rename",
      "Delete",
    ]);
  });

  test("a single selected collection shows Open, Open in Studio, Rename", () => {
    openContextMenu(0, 0, ["collection-1"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual([
      "Open",
      "Open in Studio",
      "Rename",
    ]);
  });

  test("a multi-selection omits Rename", () => {
    openContextMenu(0, 0, ["asset-1-asset-a", "collection-1"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).not.toContain("Rename");
    expect(labels).toContain("Open first in Studio");
    expect(labels).toContain("Delete");
  });

  test("empty selection (right-click on empty space) shows New Collection, Upload, and Refresh", () => {
    openContextMenu(0, 0, []);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual(["New Collection", "Upload File…", "Refresh"]);
  });

  test("closeContextMenu removes the menu from the DOM", () => {
    openContextMenu(0, 0, ["asset-1-asset-a"]);
    closeContextMenu();
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  test("ArrowDown/ArrowUp move focus between menu items, wrapping at the ends", () => {
    openContextMenu(0, 0, ["asset-1-asset-a"]);
    const items = [...document.querySelectorAll(".context-menu-item")];
    expect(document.activeElement).toBe(items[0]);

    menuEl().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[1]);

    menuEl().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    menuEl().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[items.length - 1]);
  });
});

describe("requestRename", () => {
  test("opens the rename dialog for the selected item", async () => {
    requestRename("asset-1-asset-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".dialog-title").textContent).toBe("Rename");
    expect(document.querySelector(".dialog-input").value).toBe("a.glb");
  });
});

describe("initLibraryContextMenu", () => {
  test("right-clicking an unselected item selects it and opens the menu for it", () => {
    initLibraryContextMenu();
    const el = document.querySelector('[data-id="asset-1-asset-a"]');
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(libraryState.get().selectedIds).toEqual(["asset-1-asset-a"]);
    expect(document.querySelector(".context-menu")).not.toBeNull();
  });

  test("right-clicking empty space opens the empty-selection menu", () => {
    initLibraryContextMenu();
    const container = document.getElementById("libraryItems");
    container.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual(["New Collection", "Upload File…", "Refresh"]);
  });

  test("Escape closes an open menu", () => {
    initLibraryContextMenu();
    openContextMenu(0, 0, ["asset-1-asset-a"]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});
