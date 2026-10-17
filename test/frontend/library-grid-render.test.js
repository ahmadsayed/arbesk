// @test-env dom
/**
 * Library grid render (ui/library-grid.ts): a selection-only state change
 * (click, arrow keys) re-styles the existing cards instead of rebuilding them,
 * so thumbnails aren't refetched and the grid doesn't flash.
 */

import { beforeAll, expect, test } from "bun:test";

/** @type {typeof import("../../frontend/src/js/state/library-state.ts")} */
let stateMod;

const COLLECTIONS = [
  { id: "collection-1", type: "collection", tokenId: "1", name: "Chairs", thumbnailCid: null },
  { id: "collection-2", type: "collection", tokenId: "2", name: "Tables", thumbnailCid: null },
];

const card = (id) => document.querySelector(`#libraryItems [data-id="${id}"]`);

beforeAll(async () => {
  document.body.innerHTML = `
    <div id="libraryItems"></div>
    <span id="libraryItemCount"></span>
    <div id="libraryLiveRegion"></div>`;
  stateMod = await import("../../frontend/src/js/state/library-state.ts");
  const grid = await import("../../frontend/src/js/ui/library-grid.ts");
  grid.initLibraryGrid();
});

test("selection changes keep the rendered cards", () => {
  stateMod.libraryState.set({ collections: COLLECTIONS, selectedIds: [] });
  const before = card("collection-1");
  expect(before).not.toBeNull();

  stateMod.libraryState.set({ selectedIds: ["collection-1"] });
  expect(card("collection-1")).toBe(before);
  expect(before.classList.contains("selected")).toBe(true);

  stateMod.libraryState.set({ selectedIds: ["collection-2"] });
  expect(card("collection-1")).toBe(before);
  expect(before.classList.contains("selected")).toBe(false);
  expect(card("collection-2").getAttribute("aria-selected")).toBe("true");
});

test("a new item list rebuilds the cards", () => {
  const before = card("collection-1");
  stateMod.libraryState.set({ collections: [...COLLECTIONS] });
  expect(card("collection-1")).not.toBe(before);
});
