import { describe, test, expect, beforeEach } from "@jest/globals";
import {
  pushUndoEntry,
  popUndoEntry,
  popRedoEntry,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoStacks,
  onUndoStackChange,
} from "../../frontend/src/js/engine/undo-stack.js";

const entry = (label) => ({
  type: "transform",
  label,
  items: [{ nodeId: "n1", before: [0], after: [1] }],
});

beforeEach(() => clearUndoStacks());

describe("undo-stack", () => {
  test("push enables undo, not redo; labels peek correctly", () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    pushUndoEntry(entry("Move"));
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
    expect(peekUndoLabel()).toBe("Move");
    expect(peekRedoLabel()).toBe(null);
  });

  test("popUndoEntry moves entry to redo stack; popRedoEntry moves it back", () => {
    pushUndoEntry(entry("Move"));
    const e1 = popUndoEntry();
    expect(e1.label).toBe("Move");
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect(peekRedoLabel()).toBe("Move");
    const e2 = popRedoEntry();
    expect(e2.label).toBe("Move");
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  test("pops on empty stacks return null", () => {
    expect(popUndoEntry()).toBe(null);
    expect(popRedoEntry()).toBe(null);
  });

  test("new push clears the redo stack", () => {
    pushUndoEntry(entry("Move"));
    popUndoEntry();
    pushUndoEntry(entry("Rotate"));
    expect(canRedo()).toBe(false);
    expect(peekUndoLabel()).toBe("Rotate");
  });

  test("stack is capped at 50 entries (oldest dropped)", () => {
    for (let i = 0; i < 55; i++) pushUndoEntry(entry(`E${i}`));
    const labels = [];
    let e;
    while ((e = popUndoEntry())) labels.push(e.label);
    expect(labels.length).toBe(50);
    expect(labels.at(-1)).toBe("E5"); // oldest surviving entry
  });

  test("push ignores entries without items", () => {
    pushUndoEntry({ type: "transform", label: "X", items: [] });
    pushUndoEntry(null);
    expect(canUndo()).toBe(false);
  });

  test("clearUndoStacks empties both stacks", () => {
    pushUndoEntry(entry("Move"));
    popUndoEntry();
    pushUndoEntry(entry("Rotate"));
    clearUndoStacks();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  test("onUndoStackChange fires on push/pop/clear and unsubscribes", () => {
    let calls = 0;
    const off = onUndoStackChange(() => calls++);
    pushUndoEntry(entry("Move")); // 1
    popUndoEntry(); // 2
    popRedoEntry(); // 3
    clearUndoStacks(); // 4
    expect(calls).toBe(4);
    off();
    pushUndoEntry(entry("Scale"));
    expect(calls).toBe(4);
  });
});
