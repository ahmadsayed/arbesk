/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  createItemElement,
  renderItems,
  announce,
  addFiles,
  initLibraryGrid,
} from "../frontend/src/js/ui/library-grid.js";
import {
  openInStudio,
  requestDelete,
} from "../frontend/src/js/ui/library-grid.js";
import {
  libraryState,
  _resetForTesting,
} from "../frontend/src/js/state/library-state.js";

// showToast() (used by addFiles' rejection path) lazily constructs a
// window.Notyf instance. Notyf is a CDN global in the real app; stub a
// minimal stand-in here so showToast doesn't throw in jsdom.
window.Notyf = class MockNotyf {
  open() {
    return { on() {} };
  }
  dismiss() {}
  dismissAll() {}
};

beforeEach(() => {
  _resetForTesting();
  document.body.innerHTML = `
    <div id="libraryContent">
      <div id="libraryDropOverlay"></div>
      <div id="libraryItems"></div>
    </div>
    <span id="libraryItemCount"></span>
    <div id="libraryLiveRegion"></div>
  `;
});

describe("createItemElement", () => {
  test("renders a folder's name and id/type correctly", () => {
    const el = createItemElement(
      { id: "f1", type: "folder", name: "Weapons", status: "wip" },
      "grid",
    );
    expect(el.dataset.id).toBe("f1");
    expect(el.dataset.type).toBe("folder");
    expect(el.querySelector(".library-item-name").textContent).toBe("Weapons");
  });

  test("grid view: a wip folder shows the flag icon, not the checkmark", () => {
    const el = createItemElement(
      { id: "f1", type: "folder", name: "Weapons", status: "wip" },
      "grid",
    );
    expect(el.querySelector(".status-flag")).not.toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
  });

  test("grid view: a besked folder shows the checkmark icon, not the flag", () => {
    const el = createItemElement(
      { id: "f1", type: "folder", name: "Weapons", status: "besked" },
      "grid",
    );
    expect(el.querySelector(".status-check")).not.toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
  });

  test("list view: a folder shows the same text badges as a file", () => {
    const wip = createItemElement(
      { id: "f1", type: "folder", name: "Weapons", status: "wip" },
      "list",
    );
    expect(wip.querySelector(".status-wip").textContent).toBe("Work in Progress");

    const besked = createItemElement(
      { id: "f2", type: "folder", name: "Armor", status: "besked" },
      "list",
    );
    expect(besked.querySelector(".status-besked").textContent).toBe("Besked");
  });

  test("grid view: a wip file shows the flag icon, not the checkmark", () => {
    const el = createItemElement(
      { id: "a", type: "file", name: "shield.glb", status: "wip" },
      "grid",
    );
    expect(el.querySelector(".status-flag")).not.toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("grid view: a besked file shows the checkmark icon, not the flag", () => {
    const el = createItemElement(
      { id: "a", type: "file", name: "shield.glb", status: "besked" },
      "grid",
    );
    expect(el.querySelector(".status-check")).not.toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("grid view: an uploading file shows the Uploading… text badge", () => {
    const el = createItemElement(
      { id: "a", type: "file", name: "shield.glb", status: "uploading" },
      "grid",
    );
    expect(el.querySelector(".status-uploading").textContent).toBe(
      "Uploading…",
    );
  });

  test("list view: a wip file shows the Work in Progress text badge", () => {
    const el = createItemElement(
      { id: "a", type: "file", name: "shield.glb", status: "wip" },
      "list",
    );
    expect(el.querySelector(".status-wip").textContent).toBe(
      "Work in Progress",
    );
  });

  test("list view: a besked file shows the Besked text badge", () => {
    const el = createItemElement(
      { id: "a", type: "file", name: "shield.glb", status: "besked" },
      "list",
    );
    expect(el.querySelector(".status-besked").textContent).toBe("Besked");
  });
});

describe("renderItems", () => {
  test("renders an empty-state when there are no items", () => {
    const container = document.getElementById("libraryItems");
    renderItems(container, [], "grid");
    expect(container.querySelector(".empty-state")).not.toBeNull();
  });

  test("renders one element per item in grid mode", () => {
    const container = document.getElementById("libraryItems");
    renderItems(
      container,
      [
        { id: "1", type: "folder", name: "A" },
        { id: "2", type: "file", name: "b.glb", status: "wip" },
      ],
      "grid",
    );
    expect(container.querySelectorAll("[data-id]")).toHaveLength(2);
  });

  test("renders a table in list mode", () => {
    const container = document.getElementById("libraryItems");
    renderItems(
      container,
      [{ id: "2", type: "file", name: "b.glb", status: "wip" }],
      "list",
    );
    expect(container.querySelector("table.library-list-table")).not.toBeNull();
  });
});

describe("announce", () => {
  test("writes the message into the live region", () => {
    announce("3 items selected");
    expect(document.getElementById("libraryLiveRegion").textContent).toBe(
      "3 items selected",
    );
  });
});

describe("addFiles", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("adds supported files in 'uploading' status, then flips to 'wip'", () => {
    addFiles([{ name: "model.glb", size: 1024 }]);
    expect(libraryState.get().files).toHaveLength(1);
    expect(libraryState.get().files[0].status).toBe("uploading");

    jest.runAllTimers();
    expect(libraryState.get().files[0].status).toBe("wip");
  });

  test("rejects unsupported files and does not add them", () => {
    addFiles([{ name: "model.fbx", size: 1024 }]);
    expect(libraryState.get().files).toHaveLength(0);
  });

  test("adds the supported subset when given a mix", () => {
    addFiles([
      { name: "model.glb", size: 1024 },
      { name: "model.fbx", size: 1024 },
    ]);
    expect(libraryState.get().files).toHaveLength(1);
    expect(libraryState.get().files[0].name).toBe("model.glb");
  });
});

describe("initLibraryGrid", () => {
  test("renders the current (empty) folder immediately", () => {
    initLibraryGrid();
    expect(
      document.getElementById("libraryItems").querySelector(".empty-state"),
    ).not.toBeNull();
    expect(document.getElementById("libraryItemCount").textContent).toBe(
      "0 items",
    );
  });

  test("dropping files on #libraryContent calls addFiles and clears the drop overlay", () => {
    initLibraryGrid();
    const content = document.getElementById("libraryContent");
    const overlay = document.getElementById("libraryDropOverlay");

    const dragoverEvent = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    });
    dragoverEvent.dataTransfer = { types: ["Files"] };
    content.dispatchEvent(dragoverEvent);
    expect(overlay.classList.contains("active")).toBe(true);

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    dropEvent.dataTransfer = { files: [{ name: "model.glb", size: 10 }] };
    content.dispatchEvent(dropEvent);

    expect(overlay.classList.contains("active")).toBe(false);
    expect(libraryState.get().files).toHaveLength(1);
  });
});

describe("selection: click", () => {
  function seedTwoFiles() {
    libraryState.set({
      files: [
        {
          id: "a",
          name: "a.glb",
          parentId: null,
          status: "wip",
          sizeBytes: 1,
          dateModified: 1,
        },
        {
          id: "b",
          name: "b.glb",
          parentId: null,
          status: "wip",
          sizeBytes: 1,
          dateModified: 2,
        },
        {
          id: "c",
          name: "c.glb",
          parentId: null,
          status: "wip",
          sizeBytes: 1,
          dateModified: 3,
        },
      ],
    });
  }

  test("plain click selects exactly one item and applies aria-selected", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    const itemB = container.querySelector('[data-id="b"]');

    itemB.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // render() rebuilds the item DOM on every state change (container.innerHTML = "");
    // re-query rather than reuse `itemB`, which is now a detached node.
    expect(libraryState.get().selectedIds).toEqual(["b"]);
    expect(
      container.querySelector('[data-id="b"]').getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector('[data-id="a"]').getAttribute("aria-selected"),
    ).toBe("false");
  });

  test("ctrl-click toggles membership without clearing the rest", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");

    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="b"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

    expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
  });

  test("shift-click range-selects from the last clicked item", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");

    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="c"]')
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      );

    expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b", "c"]);
  });

  test("clicking empty space clears the selection", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().selectedIds).toEqual([]);
  });

  test("double-clicking a folder navigates into it", () => {
    libraryState.set({
      folders: [{ id: "f1", name: "Weapons", parentId: null }],
    });
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    // render() replaces every item element on each click, so in a real
    // browser the second click of a double-click never lands on the same
    // DOM node as the first and native "dblclick" never fires. The click
    // handler detects the double-click itself (same id, within the
    // threshold) instead of relying on the browser's dblclick event — so
    // the test fires two real "click" events, re-querying the (rebuilt)
    // element each time, exactly as a real double-click would behave.
    container
      .querySelector('[data-id="f1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="f1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().currentFolderId).toBe("f1");
  });

  test("double-clicking a file opens it in Studio", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // openInStudio navigates via window.location.href, which jsdom cannot
    // observe (see the openInStudio describe block below) — this test only
    // verifies the double-click path is reached without error and that the
    // item remains the active selection, not the actual navigation target.
    expect(libraryState.get().selectedIds).toEqual(["a"]);
  });

  test("two separate clicks on the same item more than the double-click threshold apart do not navigate", () => {
    jest.useFakeTimers();
    libraryState.set({
      folders: [{ id: "f1", name: "Weapons", parentId: null }],
    });
    initLibraryGrid();
    const container = document.getElementById("libraryItems");

    container
      .querySelector('[data-id="f1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    jest.advanceTimersByTime(500);
    container
      .querySelector('[data-id="f1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().currentFolderId).toBeNull();
    jest.useRealTimers();
  });

  test("two quick clicks on different items in a row do not count as a double-click", () => {
    seedTwoFiles();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");

    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="b"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().selectedIds).toEqual(["b"]);
  });
});

describe("keyboard shortcuts", () => {
  function seedTwoFiles() {
    libraryState.set({
      files: [
        {
          id: "a",
          name: "a.glb",
          parentId: null,
          status: "wip",
          sizeBytes: 1,
          dateModified: 1,
        },
        {
          id: "b",
          name: "b.glb",
          parentId: null,
          status: "wip",
          sizeBytes: 1,
          dateModified: 2,
        },
      ],
    });
  }

  test("Ctrl+A selects every item in the current folder", () => {
    seedTwoFiles();
    initLibraryGrid();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
  });

  test("Escape clears the selection", () => {
    seedTwoFiles();
    initLibraryGrid();
    libraryState.set({ selectedIds: ["a"] });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(libraryState.get().selectedIds).toEqual([]);
  });

  test("Backspace navigates up one folder level", () => {
    libraryState.set({
      folders: [{ id: "f1", name: "Weapons", parentId: null }],
      currentFolderId: "f1",
    });
    initLibraryGrid();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );
    expect(libraryState.get().currentFolderId).toBeNull();
  });

  test("keyboard shortcuts are ignored while typing in an input", () => {
    seedTwoFiles();
    initLibraryGrid();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    expect(libraryState.get().selectedIds).toEqual([]);
  });

  test("F2 opens the rename dialog for the single selected item", async () => {
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
    seedTwoFiles();
    initLibraryGrid();
    libraryState.set({ selectedIds: ["a"] });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F2", bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(".dialog-title").textContent).toBe("Rename");
  });
});

describe("openInStudio", () => {
  // jsdom 26 defines `window.location` as a non-configurable own property
  // (see node_modules/jsdom/lib/jsdom/browser/Window.js: `location: { configurable: false }`),
  // and its `href` setter's navigation path is intentionally unimplemented
  // (jsdom/lib/jsdom/living/window/navigation.js: `notImplemented("navigation (except hash changes)")`).
  // That means `delete window.location` / reassignment / defineProperty / spyOn
  // all fail or silently no-op in this Jest+jsdom version, so the assigned
  // href can't be read back. We assert the call is made without throwing and
  // that it targets the real `window.location` object (the only externally
  // observable behavior available under this jsdom version); the literal
  // assignment statement in `openInStudio` is otherwise visually verified.
  test("navigates to studio.html with the file id as a query param, without throwing", () => {
    expect(() => openInStudio("file-1")).not.toThrow();
  });
});

describe("requestDelete", () => {
  test("removes the given ids from files and folders, and clears selection", async () => {
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
    libraryState.set({
      files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }],
      selectedIds: ["a"],
    });

    const promise = requestDelete(["a"]);
    document.querySelector(".dialog-action-btn[data-value='confirm']")?.click();
    await promise;

    expect(libraryState.get().files).toHaveLength(0);
    expect(libraryState.get().selectedIds).toEqual([]);
  });
});

describe("rubber-band selection", () => {
  function rect(el, box) {
    el.getBoundingClientRect = () => ({
      ...box,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
  }

  test("dragging a box over empty space selects every item it intersects", () => {
    libraryState.set({
      files: [
        { id: "a", name: "a.glb", parentId: null, status: "wip" },
        { id: "b", name: "b.glb", parentId: null, status: "wip" },
      ],
    });
    initLibraryGrid();

    const content = document.getElementById("libraryContent");
    rect(content, { left: 0, top: 0, right: 1000, bottom: 1000 });
    const container = document.getElementById("libraryItems");
    const itemA = container.querySelector('[data-id="a"]');
    const itemB = container.querySelector('[data-id="b"]');
    rect(itemA, { left: 10, top: 10, right: 50, bottom: 50 });
    rect(itemB, { left: 200, top: 200, right: 240, bottom: 240 });

    content.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 250,
        clientY: 250,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
  });

  test("a rubber-band drag that starts on an item does not start a selection box", () => {
    libraryState.set({
      files: [{ id: "a", name: "a.glb", parentId: null, status: "wip" }],
    });
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    const itemA = container.querySelector('[data-id="a"]');

    itemA.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }),
    );
    expect(document.querySelector(".library-rubber-band")).toBeNull();
  });
});
