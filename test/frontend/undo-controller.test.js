/**
 * @jest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  pushUndoEntry,
  clearUndoStacks,
  canUndo,
  canRedo,
} from "../../frontend/src/js/engine/undo-stack.js";
import {
  undo,
  redo,
  registerUndoApplier,
} from "../../frontend/src/js/engine/undo-controller.js";

// 16-element matrices; translation lives at indices 12-14 (column-major).
const BEFORE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
const AFTER = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 0, 0, 1];

function makeAnchor() {
  return {
    scaling: {},
    rotationQuaternion: null,
    position: {},
    isDisposed: () => false,
  };
}

const transformEntry = (nodeId = "n1") => ({
  type: "transform",
  label: "Move",
  items: [{ nodeId, before: BEFORE, after: AFTER }],
});

beforeEach(() => {
  global.BABYLON = {
    Vector3: class {},
    Quaternion: class {
      static Identity() {
        return new global.BABYLON.Quaternion();
      }
    },
    Matrix: {
      Compose: () => ({ m: [...AFTER] }),
      FromValues: (...v) => ({
        decompose: (s, r, t) => {
          t.x = v[12];
          t.y = v[13];
          t.z = v[14];
          return true;
        },
      }),
    },
  };
  state.nodeAnchors = new Map();
  state.pendingTransformEdits = new Map();
  state.isGizmoDragging = false;
  clearUndoStacks();
});

afterEach(() => {
  delete global.BABYLON;
});

describe("undo-controller transform apply", () => {
  test("undo restores the before matrix and stages it for Save", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());

    undo();
    expect(anchor.position.x).toBe(1); // BEFORE translation
    expect(state.pendingTransformEdits.get("n1")).toEqual([...AFTER]); // Compose mock
    expect(canRedo()).toBe(true);
  });

  test("redo re-applies the after matrix", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());
    undo();
    redo();
    expect(anchor.position.x).toBe(9); // AFTER translation
    expect(canUndo()).toBe(true);
  });

  test("undo emits TRANSFORM_STAGED with the entry node ids", () => {
    state.nodeAnchors.set("n1", makeAnchor());
    pushUndoEntry(transformEntry());
    let staged = null;
    const off = on(EVENTS.TRANSFORM_STAGED, (e) => (staged = e));
    undo();
    off();
    expect(staged).toEqual({ nodeIds: ["n1"] });
  });

  test("undo/redo are no-ops on empty stacks", () => {
    expect(() => {
      undo();
      redo();
    }).not.toThrow();
  });

  test("undo/redo are ignored while a gizmo drag is active", () => {
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    pushUndoEntry(transformEntry());
    state.isGizmoDragging = true;
    undo();
    expect(canUndo()).toBe(true); // entry not consumed
    expect(anchor.position.x).toBeUndefined();
  });

  test("missing anchors are skipped without throwing", () => {
    pushUndoEntry({
      type: "transform",
      label: "Move",
      items: [
        { nodeId: "gone", before: BEFORE, after: AFTER },
        { nodeId: "n1", before: BEFORE, after: AFTER },
      ],
    });
    const anchor = makeAnchor();
    state.nodeAnchors.set("n1", anchor);
    expect(() => undo()).not.toThrow();
    expect(anchor.position.x).toBe(1);
  });
});

describe("undo-controller registered appliers", () => {
  test("custom type applier receives each item with direction", () => {
    const calls = [];
    registerUndoApplier("color", (item, direction) =>
      calls.push([item.nodeId, direction])
    );
    pushUndoEntry({
      type: "color",
      label: "Color",
      items: [{ nodeId: "n1", meshName: "m", before: "#000000", after: "#ffffff" }],
    });
    undo();
    expect(calls).toEqual([["n1", "before"]]);
    redo();
    expect(calls).toEqual([
      ["n1", "before"],
      ["n1", "after"],
    ]);
  });

  test("color and transform entries unwind in reverse chronological order", () => {
    state.nodeAnchors.set("n1", makeAnchor());
    const colorCalls = [];
    registerUndoApplier("color", (item, direction) =>
      colorCalls.push(direction)
    );
    pushUndoEntry({
      type: "color",
      label: "Color",
      items: [{ nodeId: "n1", meshName: "m", before: "#000000", after: "#ffffff" }],
    });
    pushUndoEntry(transformEntry()); // most recent
    undo(); // transform undone first
    expect(colorCalls).toEqual([]);
    expect(canRedo()).toBe(true);
    undo(); // then the color
    expect(colorCalls).toEqual(["before"]);
    redo();
    redo(); // redo replays oldest-first
    expect(colorCalls).toEqual(["before", "after"]);
  });
});

describe("undo-controller keyboard + lifecycle", () => {
  const press = (key, opts = {}) =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, cancelable: true, ...opts })
    );

  test("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo", () => {
    state.nodeAnchors.set("n1", makeAnchor());
    pushUndoEntry(transformEntry());
    press("z", { ctrlKey: true });
    expect(canRedo()).toBe(true);
    press("z", { ctrlKey: true, shiftKey: true });
    expect(canUndo()).toBe(true);
    press("z", { ctrlKey: true });
    press("y", { ctrlKey: true });
    expect(canRedo()).toBe(false);
  });

  test("shortcut is ignored when a text input is focused", () => {
    pushUndoEntry(transformEntry());
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    press("z", { ctrlKey: true });
    expect(canUndo()).toBe(true); // not consumed
    input.remove();
  });

  test("shortcut is a silent no-op (not consumed) when stacks are empty", () => {
    const e = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false); // nothing to undo: not swallowed
    pushUndoEntry(transformEntry());
    const e2 = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      cancelable: true,
    });
    document.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(true); // entry exists: consumed
  });

  test("Ctrl+Alt+Z does not trigger undo", () => {
    pushUndoEntry(transformEntry());
    press("z", { ctrlKey: true, altKey: true });
    expect(canUndo()).toBe(true); // not consumed
    clearUndoStacks();
  });

  test("shortcut works when a color input is focused", () => {
    pushUndoEntry(transformEntry());
    const input = document.createElement("input");
    input.type = "color";
    document.body.appendChild(input);
    input.focus();
    press("z", { ctrlKey: true });
    expect(canUndo()).toBe(false); // consumed
    clearUndoStacks();
    input.remove();
  });

  test("SCENE_CLEARED clears both stacks", () => {
    pushUndoEntry(transformEntry());
    popToRedo(); // entry now sits on the redo stack
    expect(canRedo()).toBe(true);
    emit(EVENTS.SCENE_CLEARED, {});
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});

function popToRedo() {
  undo();
}
