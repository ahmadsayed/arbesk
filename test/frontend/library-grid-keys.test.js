// @test-env dom
/**
 * Library keymap (ui/library-grid.ts + ui/library-history.ts), driven through
 * real keydown events: arrows move the selection, Shift extends it, Home/End
 * jump, Alt+arrows navigate history/up/open, and the keymap stays out of the
 * way of form fields and a hidden Library view.
 */

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

/** @type {typeof import("../../frontend/src/js/state/library-state.ts")} */
let stateMod;
/** @type {typeof import("../../frontend/src/js/ui/library-history.ts")} */
let history;

const COLLECTIONS = ["A", "B", "C", "D"].map((name, i) => ({
  id: `collection-${i + 1}`,
  type: "collection",
  tokenId: String(i + 1),
  name,
  thumbnailCid: null,
}));

const get = () => stateMod.libraryState.get();
const set = (patch) => stateMod.libraryState.set(patch);

function press(key, opts = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  document.dispatchEvent(e);
  return e;
}

beforeAll(async () => {
  document.body.innerHTML = `
    <div id="libraryView">
      <input id="search" />
      <button id="libraryBackBtn"></button>
      <button id="libraryForwardBtn"></button>
      <div id="libraryItems"></div>
      <span id="libraryItemCount"></span>
      <div id="libraryLiveRegion"></div>
    </div>`;
  stateMod = await import("../../frontend/src/js/state/library-state.ts");
  history = await import("../../frontend/src/js/ui/library-history.ts");
  const grid = await import("../../frontend/src/js/ui/library-grid.ts");
  grid.initLibraryGrid();
  history.initLibraryHistory();
});

beforeEach(() => {
  document.activeElement?.blur?.();
  document.getElementById("libraryView").classList.remove("hidden");
  set({
    collections: COLLECTIONS,
    assets: [],
    currentCollectionTokenId: null,
    selectedIds: [],
    viewMode: "list",
    searchQuery: "",
  });
  history.resetLibraryHistory();
});

describe("arrow-key selection", () => {
  test("first arrow press selects the first card; End the last", () => {
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(get().selectedIds).toEqual(["collection-1"]);
    set({ selectedIds: [] });
    press("End");
    expect(get().selectedIds).toEqual(["collection-4"]);
  });

  test("list view: Up/Down step by one and clamp at the ends; Left/Right do nothing", () => {
    press("ArrowDown");
    press("ArrowDown");
    expect(get().selectedIds).toEqual(["collection-2"]);
    press("ArrowUp");
    press("ArrowUp");
    expect(get().selectedIds).toEqual(["collection-1"]);
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(get().selectedIds).toEqual(["collection-1"]);
  });

  test("grid view: Left/Right step by one; Home/End jump", () => {
    set({ viewMode: "grid", selectedIds: ["collection-2"] });
    press("ArrowRight");
    expect(get().selectedIds).toEqual(["collection-3"]);
    press("ArrowLeft");
    expect(get().selectedIds).toEqual(["collection-2"]);
    press("End");
    expect(get().selectedIds).toEqual(["collection-4"]);
    press("Home");
    expect(get().selectedIds).toEqual(["collection-1"]);
  });

  test("Shift+arrow extends a range from the anchor", () => {
    press("ArrowDown"); // anchor = 1
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(get().selectedIds).toEqual(["collection-1", "collection-2", "collection-3"]);
    press("ArrowUp", { shiftKey: true });
    expect(get().selectedIds).toEqual(["collection-1", "collection-2"]);
  });

  test("ignored while typing in a field or when the Library view is hidden", () => {
    document.getElementById("search").focus();
    press("ArrowDown");
    expect(get().selectedIds).toEqual([]);
    document.activeElement.blur();
    document.getElementById("libraryView").classList.add("hidden");
    press("ArrowDown");
    expect(get().selectedIds).toEqual([]);
  });

  test("Ctrl+arrow is left to the browser", () => {
    expect(press("ArrowDown", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(get().selectedIds).toEqual([]);
  });
});

describe("navigation keys", () => {
  test("Alt+↓ opens the selection, Alt+← / Alt+→ walk history", () => {
    set({ selectedIds: ["collection-2"] });
    press("ArrowDown", { altKey: true });
    expect(get().currentCollectionTokenId).toBe("2");
    press("ArrowLeft", { altKey: true });
    expect(get().currentCollectionTokenId).toBe(null);
    expect(get().selectedIds).toEqual(["collection-2"]);
    press("ArrowRight", { altKey: true });
    expect(get().currentCollectionTokenId).toBe("2");
  });

  test("Alt+↑ and Backspace go up", () => {
    set({ currentCollectionTokenId: "1" });
    press("ArrowUp", { altKey: true });
    expect(get().currentCollectionTokenId).toBe(null);
    set({ currentCollectionTokenId: "3" });
    press("Backspace");
    expect(get().currentCollectionTokenId).toBe(null);
    set({ currentCollectionTokenId: "2" });
    press("Backspace", { altKey: true });
    expect(get().currentCollectionTokenId).toBe(null);
  });

  test("Alt+arrows are swallowed even with nothing to go to", () => {
    expect(press("ArrowLeft", { altKey: true }).defaultPrevented).toBe(true);
    expect(press("ArrowRight", { altKey: true }).defaultPrevented).toBe(true);
  });

  test("Enter opens the single selection", () => {
    set({ selectedIds: ["collection-4"] });
    press("Enter");
    expect(get().currentCollectionTokenId).toBe("4");
  });
});
