/**
 * @jest-environment jsdom
 */
import { libraryState, _resetForTesting } from "../../frontend/src/js/state/library-state.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

beforeEach(() => _resetForTesting());

describe("libraryState.get()", () => {
  test("returns defaults", () => {
    expect(libraryState.get()).toEqual({
      collections: [],
      assets: [],
      currentCollectionTokenId: null,
      selectedIds: [],
      viewMode: "grid",
      sortBy: "name",
      searchQuery: "",
      isLoading: false,
    });
  });
});

describe("libraryState.set()", () => {
  test("merges partial update", () => {
    libraryState.set({ currentCollectionTokenId: "c1" });
    expect(libraryState.get().currentCollectionTokenId).toBe("c1");
    expect(libraryState.get().viewMode).toBe("grid");
  });

  test("emits LIBRARY_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = (payload) => {
        off(EVENTS.LIBRARY_STATE_CHANGED, handler);
        expect(payload.currentCollectionTokenId).toBe("c1");
        resolve();
      };
      on(EVENTS.LIBRARY_STATE_CHANGED, handler);
      libraryState.set({ currentCollectionTokenId: "c1" });
    });
  });
});

describe("libraryState.reset()", () => {
  test("restores defaults", () => {
    libraryState.set({ currentCollectionTokenId: "c1", viewMode: "list" });
    libraryState.reset();
    expect(libraryState.get().currentCollectionTokenId).toBeNull();
    expect(libraryState.get().viewMode).toBe("grid");
  });
});
