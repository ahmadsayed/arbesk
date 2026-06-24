/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderBreadcrumb, initLibraryToolbar } from "../frontend/src/js/ui/library-toolbar.js";
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

beforeEach(() => {
  _resetForTesting();
  window.focusTrap = {
    createFocusTrap: () => ({
      activate() { return this; },
      deactivate() { return this; },
    }),
  };
  document.body.innerHTML = `
    <button id="libraryUpBtn" hidden></button>
    <nav id="libraryBreadcrumb"></nav>
    <input id="librarySearchInput" />
    <select id="librarySortSelect"><option value="name">Name</option><option value="date">Date</option></select>
    <button id="libraryGridViewBtn" class="active" data-view="grid"></button>
    <button id="libraryListViewBtn" data-view="list"></button>
    <div id="libraryItems"></div>
  `;
});

describe("renderBreadcrumb", () => {
  test("renders Home only at the root", () => {
    const container = document.getElementById("libraryBreadcrumb");
    renderBreadcrumb(container, [], null);
    expect(container.querySelectorAll(".pathbar-segment, .pathbar-current")).toHaveLength(1);
    expect(container.textContent).toContain("Home");
  });

  test("renders Home and the current collection name", () => {
    const collections = [{ tokenId: "1", name: "Characters" }];
    const container = document.getElementById("libraryBreadcrumb");
    renderBreadcrumb(container, collections, "1");
    expect(container.textContent).toContain("Home");
    expect(container.textContent).toContain("Characters");
    expect(container.querySelector(".pathbar-current").textContent).toBe("Characters");
  });
});

describe("breadcrumb click navigation", () => {
  test("clicking Home navigates back to the collections list", () => {
    libraryState.set({
      collections: [{ id: "c1", tokenId: "1", name: "Characters" }],
      currentCollectionTokenId: "1",
    });
    initLibraryToolbar();
    document.querySelector('[data-collection-token-id=""]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(libraryState.get().currentCollectionTokenId).toBeNull();
  });
});

describe("search input", () => {
  test("typing updates libraryState.searchQuery", () => {
    initLibraryToolbar();
    const input = document.getElementById("librarySearchInput");
    input.value = "shield";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(libraryState.get().searchQuery).toBe("shield");
  });
});

describe("sort select", () => {
  test("changing it updates libraryState.sortBy", () => {
    initLibraryToolbar();
    const select = document.getElementById("librarySortSelect");
    select.value = "date";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(libraryState.get().sortBy).toBe("date");
  });
});

describe("view toggle", () => {
  test("clicking the list view button switches viewMode and toggles active classes", () => {
    initLibraryToolbar();
    document.getElementById("libraryListViewBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(libraryState.get().viewMode).toBe("list");
    expect(document.getElementById("libraryListViewBtn").classList.contains("active")).toBe(true);
    expect(document.getElementById("libraryGridViewBtn").classList.contains("active")).toBe(false);
  });
});
