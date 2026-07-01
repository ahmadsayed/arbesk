/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  createItemElement,
  renderItems,
  announce,
  initLibraryGrid,
  openInStudio,
} from "../frontend/src/js/ui/library-grid.js";
import {
  libraryState,
  _resetForTesting,
} from "../frontend/src/js/state/library-state.js";

beforeEach(() => {
  _resetForTesting();
  document.body.innerHTML = `
    <div id="libraryContent">
      <div id="libraryItems"></div>
    </div>
    <span id="libraryItemCount"></span>
    <div id="libraryLiveRegion"></div>
  `;
});

describe("createItemElement", () => {
  test("renders a collection's name and id/type correctly", () => {
    const el = createItemElement(
      { id: "c1", type: "collection", name: "Weapons", status: "besked" },
      "grid",
    );
    expect(el.dataset.id).toBe("c1");
    expect(el.dataset.type).toBe("collection");
    expect(el.querySelector(".library-item-name").textContent).toBe("Weapons");
  });

  test("grid view: a besked collection shows the checkmark icon, not the flag", () => {
    const el = createItemElement(
      { id: "c1", type: "collection", name: "Weapons", status: "besked" },
      "grid",
    );
    expect(el.querySelector(".status-check")).not.toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
  });

  test("grid view: a wip collection shows the flag icon, not the checkmark", () => {
    const el = createItemElement(
      { id: "c1", type: "collection", name: "Weapons", status: "wip" },
      "grid",
    );
    expect(el.querySelector(".status-flag")).not.toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
  });

  test("list view: a collection shows the same text badges as an asset", () => {
    const wip = createItemElement(
      { id: "c1", type: "collection", name: "Weapons", status: "wip" },
      "list",
    );
    expect(wip.querySelector(".status-wip").textContent).toBe("Work in Progress");

    const besked = createItemElement(
      { id: "c2", type: "collection", name: "Armor", status: "besked" },
      "list",
    );
    expect(besked.querySelector(".status-besked").textContent).toBe("Besked");
  });

  test("grid view: a besked asset shows the checkmark icon, not the flag", () => {
    const el = createItemElement(
      { id: "a", type: "asset", name: "shield.glb", status: "besked" },
      "grid",
    );
    expect(el.querySelector(".status-check")).not.toBeNull();
    expect(el.querySelector(".status-flag")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("grid view: a wip asset shows the flag icon, not the checkmark", () => {
    const el = createItemElement(
      { id: "a", type: "asset", name: "shield.glb", status: "wip" },
      "grid",
    );
    expect(el.querySelector(".status-flag")).not.toBeNull();
    expect(el.querySelector(".status-check")).toBeNull();
    expect(el.querySelector(".status-badge")).toBeNull();
  });

  test("list view: a wip asset shows the Work in Progress text badge", () => {
    const el = createItemElement(
      { id: "a", type: "asset", name: "shield.glb", status: "wip" },
      "list",
    );
    expect(el.querySelector(".status-wip").textContent).toBe(
      "Work in Progress",
    );
  });

  test("list view: a besked asset shows the Besked text badge", () => {
    const el = createItemElement(
      { id: "a", type: "asset", name: "shield.glb", status: "besked" },
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
        { id: "1", type: "collection", name: "A" },
        { id: "2", type: "asset", name: "b.glb", status: "besked" },
      ],
      "grid",
    );
    expect(container.querySelectorAll("[data-id]")).toHaveLength(2);
  });

  test("renders a table in list mode", () => {
    const container = document.getElementById("libraryItems");
    renderItems(
      container,
      [{ id: "2", type: "asset", name: "b.glb", status: "besked" }],
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

describe("initLibraryGrid", () => {
  test("renders the current (empty) view immediately", () => {
    initLibraryGrid();
    expect(
      document.getElementById("libraryItems").querySelector(".empty-state"),
    ).not.toBeNull();
    expect(document.getElementById("libraryItemCount").textContent).toBe(
      "0 items",
    );
  });
});

function seedAssets() {
  libraryState.set({
    assets: [
      {
        id: "a",
        type: "asset",
        assetId: "asset-a",
        tokenId: "1",
        name: "a.glb",
        status: "besked",
        manifestCid: "bafyA",
      },
      {
        id: "b",
        type: "asset",
        assetId: "asset-b",
        tokenId: "1",
        name: "b.glb",
        status: "besked",
        manifestCid: "bafyB",
      },
      {
        id: "c",
        type: "asset",
        assetId: "asset-c",
        tokenId: "1",
        name: "c.glb",
        status: "besked",
        manifestCid: "bafyC",
      },
    ],
    currentCollectionTokenId: "1",
  });
}

describe("selection: click", () => {
  test("plain click selects exactly one item and applies aria-selected", () => {
    seedAssets();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    const itemB = container.querySelector('[data-id="b"]');

    itemB.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().selectedIds).toEqual(["b"]);
    expect(
      container.querySelector('[data-id="b"]').getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector('[data-id="a"]').getAttribute("aria-selected"),
    ).toBe("false");
  });

  test("ctrl-click toggles membership without clearing the rest", () => {
    seedAssets();
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
    seedAssets();
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
    seedAssets();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().selectedIds).toEqual([]);
  });

  test("double-clicking a collection navigates into it", () => {
    libraryState.set({
      collections: [{ id: "c1", type: "collection", tokenId: "1", name: "Weapons" }],
    });
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    container
      .querySelector('[data-id="c1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="c1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().currentCollectionTokenId).toBe("1");
  });

  test("double-clicking an asset opens it in Studio", () => {
    seedAssets();
    initLibraryGrid();
    const container = document.getElementById("libraryItems");
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector('[data-id="a"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().selectedIds).toEqual(["a"]);
  });

  test("two separate clicks on the same item more than the double-click threshold apart do not navigate", () => {
    jest.useFakeTimers();
    libraryState.set({
      collections: [{ id: "c1", type: "collection", tokenId: "1", name: "Weapons" }],
    });
    initLibraryGrid();
    const container = document.getElementById("libraryItems");

    container
      .querySelector('[data-id="c1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    jest.advanceTimersByTime(500);
    container
      .querySelector('[data-id="c1"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(libraryState.get().currentCollectionTokenId).toBeNull();
    jest.useRealTimers();
  });

  test("two quick clicks on different items in a row do not count as a double-click", () => {
    seedAssets();
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
  function seedAssets() {
    libraryState.set({
      assets: [
        {
          id: "a",
          type: "asset",
          assetId: "asset-a",
          tokenId: "1",
          name: "a.glb",
          status: "besked",
          manifestCid: "bafyA",
        },
        {
          id: "b",
          type: "asset",
          assetId: "asset-b",
          tokenId: "1",
          name: "b.glb",
          status: "besked",
          manifestCid: "bafyB",
        },
      ],
      currentCollectionTokenId: "1",
    });
  }

  test("Ctrl+A selects every item in the current view", () => {
    seedAssets();
    initLibraryGrid();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    expect(libraryState.get().selectedIds.sort()).toEqual(["a", "b"]);
  });

  test("Escape clears the selection", () => {
    seedAssets();
    initLibraryGrid();
    libraryState.set({ selectedIds: ["a"] });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(libraryState.get().selectedIds).toEqual([]);
  });

  test("Backspace returns to the collections list", () => {
    libraryState.set({
      collections: [{ id: "c1", type: "collection", tokenId: "1", name: "Weapons" }],
      currentCollectionTokenId: "1",
    });
    initLibraryGrid();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );
    expect(libraryState.get().currentCollectionTokenId).toBeNull();
  });

  test("keyboard shortcuts are ignored while typing in an input", () => {
    seedAssets();
    initLibraryGrid();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
    );
    expect(libraryState.get().selectedIds).toEqual([]);
  });
});

describe("openInStudio", () => {
  test("navigates to the Studio view with the token and asset ids, without throwing", () => {
    expect(() => openInStudio("1", "asset-a")).not.toThrow();
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
      assets: [
        { id: "a", type: "asset", assetId: "asset-a", tokenId: "1", name: "a.glb", status: "besked" },
        { id: "b", type: "asset", assetId: "asset-b", tokenId: "1", name: "b.glb", status: "besked" },
      ],
      currentCollectionTokenId: "1",
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
      assets: [{ id: "a", type: "asset", assetId: "asset-a", tokenId: "1", name: "a.glb", status: "besked" }],
      currentCollectionTokenId: "1",
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
