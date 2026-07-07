/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeEach, beforeAll } from "@jest/globals";

// Mock the store: capture the subscriber, drive renders manually.
let subscriber = null;
const storeMock = {
  getState: jest.fn(() => ({
    entries: [],
    activeCid: null,
    publishedCid: null,
    isLoading: false,
  })),
  subscribe: jest.fn((fn) => {
    subscriber = fn;
    return () => {};
  }),
  activeIndex: jest.fn(() => -1),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => []),
  _deps: {},
};
jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);

let initSceneClock;
beforeAll(async () => {
  ({ initSceneClock } = await import(
    "../../frontend/src/js/ui/scene-clock.js"
  ));
});

const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
];

function setStoreState(state) {
  storeMock.getState.mockReturnValue(state);
  storeMock.activeIndex.mockReturnValue(
    state.entries.findIndex((e) => e.cid === state.activeCid)
  );
  if (subscriber) subscriber(state);
}

describe("scene-clock", () => {
  let viewport;

  beforeEach(() => {
    document.getElementById("sceneClock")?.remove();
    document.getElementById("viewport")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);
    storeMock.loadVersion.mockClear();
    initSceneClock();
  });

  test("hidden while the chain is empty, visible once populated", () => {
    const root = document.getElementById("sceneClock");
    expect(root.hidden).toBe(true);

    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    expect(root.hidden).toBe(false);
  });

  test("expands on focusin, collapses on Escape", () => {
    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    const root = document.getElementById("sceneClock");
    const dial = root.querySelector(".version-clock");

    dial.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(root.classList.contains("expanded")).toBe(true);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(root.classList.contains("expanded")).toBe(false);
  });

  test("keyboard commit loads the landed version via the store", () => {
    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    const dial = document.querySelector("#sceneClock .version-clock");
    dial.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true })
    );
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });
});
