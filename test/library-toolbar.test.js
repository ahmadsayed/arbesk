/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderBreadcrumb, requestNewFolder, initLibraryToolbar } from "../frontend/src/js/ui/library-toolbar.js";
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
    <nav id="libraryBreadcrumb"></nav>
    <input id="librarySearchInput" />
    <select id="librarySortSelect"><option value="name">Name</option><option value="date">Date</option></select>
    <button id="libraryNewFolderBtn"></button>
    <button id="libraryUploadBtn"></button>
    <input id="libraryFileInput" type="file" />
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

  test("renders the full ancestor chain with the last segment marked current", () => {
    const folders = [{ id: "f1", name: "Characters", parentId: null }];
    const container = document.getElementById("libraryBreadcrumb");
    renderBreadcrumb(container, folders, "f1");
    expect(container.textContent).toContain("Home");
    expect(container.textContent).toContain("Characters");
    expect(container.querySelector(".pathbar-current").textContent).toBe("Characters");
  });
});

describe("breadcrumb click navigation", () => {
  test("clicking a non-current segment navigates to that folder", () => {
    libraryState.set({
      folders: [
        { id: "f1", name: "Characters", parentId: null },
        { id: "f2", name: "Heroes", parentId: "f1" },
      ],
      currentFolderId: "f2",
    });
    initLibraryToolbar();
    document.querySelector('[data-folder-id="f1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(libraryState.get().currentFolderId).toBe("f1");
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

describe("upload button", () => {
  test("clicking it triggers the hidden file input", () => {
    initLibraryToolbar();
    const fileInput = document.getElementById("libraryFileInput");
    const clickSpy = jest.spyOn(fileInput, "click");
    document.getElementById("libraryUploadBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe("requestNewFolder", () => {
  test("creates a folder named via the dialog in the current folder", async () => {
    libraryState.set({ currentFolderId: "f1", folders: [{ id: "f1", name: "Characters", parentId: null }] });
    const promise = requestNewFolder();
    const dialogInput = document.querySelector(".dialog-input");
    dialogInput.value = "New Folder";
    document.querySelector(".dialog-confirm-btn")?.click();
    await promise;

    const created = libraryState.get().folders.find((f) => f.name === "New Folder");
    expect(created).toBeDefined();
    expect(created.parentId).toBe("f1");
  });

  test("does nothing if the dialog is cancelled", async () => {
    const promise = requestNewFolder();
    document.querySelector(".dialog-cancel-btn")?.click();
    await promise;
    expect(libraryState.get().folders).toHaveLength(0);
  });
});
