import { beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { clearUndoStacks, popUndoEntry, canUndo } from "../../frontend/src/js/engine/undo-stack.js";
import {
  selectedIds,
  snapshotMatrices,
  commitTransformChange,
} from "../../frontend/src/js/engine/transform-commit.js";

// readNodeTransformMatrix returns Array.from(BABYLON.Matrix.Compose(scaling,
// rotationQuaternion, position).m); matricesEqual compares 16 entries.
const M = (tx) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, 0, 1];
let matrices;
beforeEach(() => {
  matrices = { a: M(0), b: M(0) };
  global.BABYLON = {
    Matrix: { Compose: (_s, _r, p) => ({ m: [...matrices[p.id]] }) },
    Quaternion: { Identity: () => ({}) },
  };
  state.nodeAnchors = new Map(
    ["a", "b"].map((id) => [
      id,
      { isDisposed: () => false, scaling: {}, rotationQuaternion: {}, position: { id } },
    ])
  );
  state.selectedNodeIds = new Set();
  state.highlightedNodeId = null;
  state.pendingTransformEdits = new Map();
  clearUndoStacks();
});

describe("transform-commit", () => {
  test("selectedIds prefers the multi-selection, then the highlight", () => {
    expect(selectedIds()).toEqual([]);
    state.highlightedNodeId = "a";
    expect(selectedIds()).toEqual(["a"]);
    state.selectedNodeIds = new Set(["a", "b"]);
    expect(selectedIds()).toEqual(["a", "b"]);
  });

  test("only moved nodes are staged, and one undo entry is pushed", () => {
    const before = snapshotMatrices(["a", "b"]);
    matrices.a = M(7);
    const staged = jest.fn();
    const off = on(EVENTS.TRANSFORM_STAGED, staged);

    expect(commitTransformChange("Drop to floor", before)).toEqual(["a"]);
    expect([...state.pendingTransformEdits.keys()]).toEqual(["a"]);
    expect(staged).toHaveBeenCalledWith({ nodeIds: ["a"] });
    const entry = popUndoEntry();
    expect(entry.label).toBe("Drop to floor");
    expect(entry.items).toEqual([{ nodeId: "a", before: M(0), after: M(7) }]);
    off();
  });

  test("no movement stages nothing and pushes nothing", () => {
    const before = snapshotMatrices(["a"]);
    expect(commitTransformChange("Move", before)).toEqual([]);
    expect(state.pendingTransformEdits.size).toBe(0);
    expect(canUndo()).toBe(false);
    expect(commitTransformChange("Move", null)).toEqual([]);
  });
});
