/**
 * @jest-environment jsdom
 */
import { libraryState, _resetForTesting } from "../../frontend/src/js/state/library-state.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

beforeEach(() => _resetForTesting());

describe("libraryState.get()", () => {
  test("returns defaults", () => {
    expect(libraryState.get()).toEqual({
      folders: [],
      files: [],
      currentFolderId: null,
      selectedIds: [],
      viewMode: "grid",
      sortBy: "name",
      searchQuery: "",
    });
  });
});

describe("libraryState.set()", () => {
  test("merges partial update", () => {
    libraryState.set({ currentFolderId: "f1" });
    expect(libraryState.get().currentFolderId).toBe("f1");
    expect(libraryState.get().viewMode).toBe("grid");
  });

  test("emits LIBRARY_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = (payload) => {
        off(EVENTS.LIBRARY_STATE_CHANGED, handler);
        expect(payload.currentFolderId).toBe("f1");
        resolve();
      };
      on(EVENTS.LIBRARY_STATE_CHANGED, handler);
      libraryState.set({ currentFolderId: "f1" });
    });
  });
});

describe("libraryState.reset()", () => {
  test("restores defaults", () => {
    libraryState.set({ currentFolderId: "f1", viewMode: "list" });
    libraryState.reset();
    expect(libraryState.get().currentFolderId).toBeNull();
    expect(libraryState.get().viewMode).toBe("grid");
  });
});
