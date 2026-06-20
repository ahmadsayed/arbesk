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
import { libraryState, _resetForTesting } from "../frontend/src/js/state/library-state.js";

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
  test("renders a folder with no status badge or icon", () => {
    const el = createItemElement({ id: "f1", type: "folder", name: "Weapons" }, "grid");
    expect(el.dataset.id).toBe("f1");
    expect(el.dataset.type).toBe("folder");
    expect(el.querySelector(".library-item-name").textContent).toBe("Weapons");
    expect(el.querySelector(".status-badge")).toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
  });

  test("grid view: a wip file shows the flag icon, not the checkmark", () => {
    const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "wip" }, "grid");
    expect(el.querySelector(".status-flag")).not.toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("grid view: a besked file shows the checkmark icon, not the flag", () => {
    const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "besked" }, "grid");
    expect(el.querySelector(".status-check")).not.toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("grid view: an uploading file shows the Uploading… text badge", () => {
    const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "uploading" }, "grid");
    expect(el.querySelector(".status-uploading").textContent).toBe("Uploading…");
  });

  test("list view: a wip file shows the Work in Progress text badge", () => {
    const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "wip" }, "list");
    expect(el.querySelector(".status-wip").textContent).toBe("Work in Progress");
  });

  test("list view: a besked file shows the Besked text badge", () => {
    const el = createItemElement({ id: "a", type: "file", name: "shield.glb", status: "besked" }, "list");
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
    renderItems(container, [
      { id: "1", type: "folder", name: "A" },
      { id: "2", type: "file", name: "b.glb", status: "wip" },
    ], "grid");
    expect(container.querySelectorAll("[data-id]")).toHaveLength(2);
  });

  test("renders a table in list mode", () => {
    const container = document.getElementById("libraryItems");
    renderItems(container, [{ id: "2", type: "file", name: "b.glb", status: "wip" }], "list");
    expect(container.querySelector("table.library-list-table")).not.toBeNull();
  });
});

describe("announce", () => {
  test("writes the message into the live region", () => {
    announce("3 items selected");
    expect(document.getElementById("libraryLiveRegion").textContent).toBe("3 items selected");
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
    addFiles([{ name: "model.glb", size: 1024 }, { name: "model.fbx", size: 1024 }]);
    expect(libraryState.get().files).toHaveLength(1);
    expect(libraryState.get().files[0].name).toBe("model.glb");
  });
});

describe("initLibraryGrid", () => {
  test("renders the current (empty) folder immediately", () => {
    initLibraryGrid();
    expect(document.getElementById("libraryItems").querySelector(".empty-state")).not.toBeNull();
    expect(document.getElementById("libraryItemCount").textContent).toBe("0 items");
  });

  test("dropping files on #libraryContent calls addFiles and clears the drop overlay", () => {
    initLibraryGrid();
    const content = document.getElementById("libraryContent");
    const overlay = document.getElementById("libraryDropOverlay");

    content.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    expect(overlay.classList.contains("active")).toBe(true);

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    dropEvent.dataTransfer = { files: [{ name: "model.glb", size: 10 }] };
    content.dispatchEvent(dropEvent);

    expect(overlay.classList.contains("active")).toBe(false);
    expect(libraryState.get().files).toHaveLength(1);
  });
});
