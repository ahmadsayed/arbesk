import { beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  hasUnsavedChanges,
  registerPendingSource,
  notifyPendingEditsChanged,
  onBeforeUnload,
} from "../../frontend/src/js/state/unsaved-changes.js";

beforeEach(() => {
  state.pendingTransformEdits = new Map();
  state.pendingChildRefs = [];
  state.pendingChildRefRemovals = new Set();
  state.pendingPostProcessorEdits = new Map();
  state.pendingSourceOverrides = new Map();
});

describe("hasUnsavedChanges", () => {
  test("false when every pending collection is empty", () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  test.each([
    ["transform", () => state.pendingTransformEdits.set("n", [1])],
    ["child ref", () => state.pendingChildRefs.push({ node_id: "c" })],
    ["child removal", () => state.pendingChildRefRemovals.add("c")],
    ["post-processor", () => state.pendingPostProcessorEdits.set("n", {})],
    ["source override", () => state.pendingSourceOverrides.set("n", {})],
  ])("true with a pending %s", (_label, stage) => {
    stage();
    expect(hasUnsavedChanges()).toBe(true);
  });

  test("registered sources count, and unregister removes them", () => {
    let dirty = true;
    const off = registerPendingSource(() => dirty);
    expect(hasUnsavedChanges()).toBe(true);
    dirty = false;
    expect(hasUnsavedChanges()).toBe(false);
    dirty = true;
    off();
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe("signals", () => {
  test("notifyPendingEditsChanged emits PENDING_EDITS_CHANGED", () => {
    expect(EVENTS.PENDING_EDITS_CHANGED).toBe("pending:editsChanged");
    const seen = jest.fn();
    const off = on(EVENTS.PENDING_EDITS_CHANGED, seen);
    notifyPendingEditsChanged();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  test("onBeforeUnload prompts only when dirty", () => {
    const clean = { preventDefault: jest.fn() };
    onBeforeUnload(clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();

    state.pendingTransformEdits.set("n", [1]);
    const dirty = { preventDefault: jest.fn(), returnValue: undefined };
    onBeforeUnload(dirty);
    expect(dirty.preventDefault).toHaveBeenCalledTimes(1);
    expect(dirty.returnValue).toBe("");
  });
});
