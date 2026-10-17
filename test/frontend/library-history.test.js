// @test-env dom
/**
 * Library back/forward/up navigation (ui/library-history.ts): every change of
 * currentCollectionTokenId is recorded; Back/Forward walk the trail without
 * recording new visits, and arriving at Home re-selects the collection left.
 */

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

/** @type {typeof import("../../frontend/src/js/ui/library-history.ts")} */
let history;
/** @type {typeof import("../../frontend/src/js/state/library-state.ts")} */
let stateMod;

const COLLECTIONS = [
  { id: "collection-1", type: "collection", tokenId: "1", name: "Chairs" },
  { id: "collection-2", type: "collection", tokenId: "2", name: "Tables" },
];

const tokenId = () => stateMod.libraryState.get().currentCollectionTokenId;
const open = (id) =>
  stateMod.libraryState.set({ currentCollectionTokenId: id, selectedIds: [] });
const backBtn = () => document.getElementById("libraryBackBtn");
const forwardBtn = () => document.getElementById("libraryForwardBtn");

beforeAll(async () => {
  document.body.innerHTML = `
    <button id="libraryBackBtn" disabled></button>
    <button id="libraryForwardBtn" disabled></button>
    <div id="libraryLiveRegion"></div>`;
  stateMod = await import("../../frontend/src/js/state/library-state.ts");
  history = await import("../../frontend/src/js/ui/library-history.ts");
  history.initLibraryHistory();
});

beforeEach(() => {
  stateMod.libraryState.set({
    collections: COLLECTIONS,
    currentCollectionTokenId: null,
    selectedIds: [],
  });
  history.resetLibraryHistory();
});

describe("library history", () => {
  test("starts with nothing to go back or forward to", () => {
    expect(backBtn().disabled).toBe(true);
    expect(forwardBtn().disabled).toBe(true);
    expect(history.goBack()).toBe(false);
  });

  test("Back and Forward walk the visited collections", () => {
    open("1");
    open("2");
    expect(backBtn().disabled).toBe(false);

    expect(history.goBack()).toBe(true);
    expect(tokenId()).toBe("1");
    expect(forwardBtn().disabled).toBe(false);

    history.goBack();
    expect(tokenId()).toBe(null);
    expect(backBtn().disabled).toBe(true);

    history.goForward();
    history.goForward();
    expect(tokenId()).toBe("2");
    expect(forwardBtn().disabled).toBe(true);
  });

  test("a new visit after going back drops the forward trail", () => {
    open("1");
    history.goBack();
    expect(forwardBtn().disabled).toBe(false);
    open("2");
    expect(forwardBtn().disabled).toBe(true);
    history.goBack();
    expect(tokenId()).toBe(null);
  });

  test("going back to Home selects the collection just left", () => {
    open("2");
    history.goBack();
    expect(stateMod.libraryState.get().selectedIds).toEqual(["collection-2"]);
  });

  test("Up returns Home, selects the collection, and is itself a visit", () => {
    expect(history.goUp()).toBe(false);
    open("1");
    expect(history.goUp()).toBe(true);
    expect(tokenId()).toBe(null);
    expect(stateMod.libraryState.get().selectedIds).toEqual(["collection-1"]);
    history.goBack();
    expect(tokenId()).toBe("1");
  });

  test("the breadcrumb's empty Home id counts as Home", () => {
    open("1");
    open("");
    history.goBack();
    expect(tokenId()).toBe("1");
    history.goBack();
    expect(backBtn().disabled).toBe(true);
  });
});
