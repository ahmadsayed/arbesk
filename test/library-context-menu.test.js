/**
 * @jest-environment jsdom
 */
import {
  openContextMenu,
  closeContextMenu,
  requestRename,
  requestMoveToFolder,
  requestBeskIt,
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
      <div class="library-item" data-id="a" data-type="file"></div>
      <div class="library-item" data-id="f1" data-type="folder"></div>
    </div>
  `;
  libraryState.set({
    folders: [{ id: "f1", name: "Weapons", parentId: null, status: "wip" }],
    files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }],
  });
});

afterEach(() => closeContextMenu());

function menuEl() {
  return document.querySelector(".context-menu");
}

describe("openContextMenu / closeContextMenu", () => {
  test("renders a menu positioned at the given coordinates", () => {
    openContextMenu(120, 80, ["a"]);
    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("80px");
  });

  test("a single selected file shows Besk it, Open in Studio, Rename, Move, Delete", () => {
    openContextMenu(0, 0, ["a"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual([
      "Besk it",
      "Open in Studio",
      "Rename",
      "Move to folder…",
      "Delete",
    ]);
  });

  test("a single selected folder shows Besk it, Open, Rename, Move, Delete", () => {
    openContextMenu(0, 0, ["f1"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual([
      "Besk it",
      "Open",
      "Rename",
      "Move to folder…",
      "Delete",
    ]);
  });

  test("a multi-selection omits Rename", () => {
    openContextMenu(0, 0, ["a", "f1"]);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).not.toContain("Rename");
    expect(labels).toContain("Besk it");
    expect(labels).toContain("Delete");
  });

  test("empty selection (right-click on empty space) shows New Folder, Upload, and a disabled Paste", () => {
    openContextMenu(0, 0, []);
    const labels = [...document.querySelectorAll(".context-menu-item")].map(
      (el) => el.textContent.trim(),
    );
    expect(labels).toEqual(["New Folder", "Upload", "Paste"]);
    expect(
      document.querySelector('.context-menu-item[data-action="paste"]')
        .disabled,
    ).toBe(true);
  });

  test("closeContextMenu removes the menu from the DOM", () => {
    openContextMenu(0, 0, ["a"]);
    closeContextMenu();
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  test("ArrowDown/ArrowUp move focus between menu items, wrapping at the ends", () => {
    openContextMenu(0, 0, ["a"]);
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
  test("renames the file using the typed value", async () => {
    const promise = requestRename("a");
    document.querySelector(".dialog-input").value = "renamed.glb";
    document.querySelector(".dialog-confirm-btn")?.click();
    await promise;
    expect(libraryState.get().files.find((f) => f.id === "a").name).toBe(
      "renamed.glb",
    );
  });
});

describe("requestMoveToFolder", () => {
  test("moves the file into the chosen folder", async () => {
    const promise = requestMoveToFolder(["a"]);
    document.querySelector('[data-move-target="f1"]')?.click();
    await promise;
    expect(libraryState.get().files.find((f) => f.id === "a").parentId).toBe(
      "f1",
    );
  });

  test("Escape dismisses the move dialog without moving", async () => {
    const promise = requestMoveToFolder(["a"]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await promise;
    expect(
      libraryState.get().files.find((f) => f.id === "a").parentId,
    ).toBeNull();
  });

  test("clicking the backdrop dismisses the move dialog without moving", async () => {
    const promise = requestMoveToFolder(["a"]);
    const backdrop = document.querySelector(".dialog-backdrop");
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await promise;
    expect(
      libraryState.get().files.find((f) => f.id === "a").parentId,
    ).toBeNull();
  });

  test("clicking the Cancel button dismisses the move dialog without moving", async () => {
    const promise = requestMoveToFolder(["a"]);
    document.querySelector(".dialog-cancel-btn")?.click();
    await promise;
    expect(
      libraryState.get().files.find((f) => f.id === "a").parentId,
    ).toBeNull();
  });
});

describe("requestBeskIt", () => {
  test("flips status from wip to besked immediately, with no confirmation dialog", async () => {
    await requestBeskIt(["a"]);
    expect(document.querySelector(".dialog-overlay")).toBeNull();
    expect(libraryState.get().files.find((f) => f.id === "a").status).toBe(
      "besked",
    );
  });

  test("besks a folder independently of its children's status", async () => {
    await requestBeskIt(["f1"]);
    expect(libraryState.get().folders.find((f) => f.id === "f1").status).toBe(
      "besked",
    );
    // Besking the folder does not cascade to its children.
    expect(libraryState.get().files.find((f) => f.id === "a").status).toBe(
      "wip",
    );
  });
});

describe("initLibraryContextMenu", () => {
  test("right-clicking an unselected item selects it and opens the menu for it", () => {
    initLibraryContextMenu();
    const el = document.querySelector('[data-id="a"]');
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    expect(libraryState.get().selectedIds).toEqual(["a"]);
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
    expect(labels).toEqual(["New Folder", "Upload", "Paste"]);
  });

  test("Escape closes an open menu", () => {
    initLibraryContextMenu();
    openContextMenu(0, 0, ["a"]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(".context-menu")).toBeNull();
  });
});
