/**
 * @jest-environment jsdom
 */
import { uiState, _resetForTesting } from "../../frontend/src/js/state/ui-state.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

beforeEach(() => _resetForTesting());

describe("uiState.get()", () => {
  test("returns defaults: selectedNodeId null, nestingDepth 0", () => {
    expect(uiState.get()).toEqual({
      selectedNodeId: null,
      nestingDepth: 0,
    });
  });
});

describe("uiState.set()", () => {
  test("merges partial update", () => {
    uiState.set({ selectedNodeId: "node-1" });
    expect(uiState.get().selectedNodeId).toBe("node-1");
    expect(uiState.get().nestingDepth).toBe(0);
  });

  test("emits UI_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = (payload) => {
        off(EVENTS.UI_STATE_CHANGED, handler);
        expect(payload.selectedNodeId).toBe("node-1");
        expect(payload.nestingDepth).toBe(0);
        resolve();
      };
      on(EVENTS.UI_STATE_CHANGED, handler);
      uiState.set({ selectedNodeId: "node-1" });
    });
  });
});

describe("uiState.reset()", () => {
  test("restores selectedNodeId to null and nestingDepth to 0", () => {
    uiState.set({ selectedNodeId: "node-1", nestingDepth: 3 });
    uiState.reset();
    expect(uiState.get()).toEqual({ selectedNodeId: null, nestingDepth: 0 });
  });
});
