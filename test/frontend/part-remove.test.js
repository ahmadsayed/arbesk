// @test-env dom
/**
 * Part removal (engine/part-remove.ts): removing the selected part hides its
 * meshes, stages it in pendingPartRemovals for Save, pushes a "part" undo
 * entry, and reselects the whole model. The model's last part can't go.
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const _pushUndoEntry = jest.fn();
const _registerUndoApplier = jest.fn();
const _selectNode = jest.fn();
const _emit = jest.fn();

async function loadModule() {
  await mock.module("@arbesk/asset-core/events/bus.js", () => ({
    emit: _emit,
    on: jest.fn(),
    EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  }));
  await mock.module("../../frontend/src/js/engine/scene-selection.js", () => ({ selectNode: _selectNode }));
  await mock.module("../../frontend/src/js/engine/undo-stack.js", () => ({ pushUndoEntry: _pushUndoEntry }));
  await mock.module("../../frontend/src/js/engine/undo-controller.js", () => ({
    registerUndoApplier: _registerUndoApplier,
  }));
  const mod = await import("../../frontend/src/js/engine/part-remove.js");
  const { state } = await import("../../frontend/src/js/engine/state.js");
  return { mod, state };
}

/** A stand-in Babylon mesh tracking enabled/pickable. */
function mesh(name, vertices = 100) {
  let enabled = true;
  return {
    name,
    isPickable: true,
    getTotalVertices: () => vertices,
    isEnabled: () => enabled,
    setEnabled: (v) => { enabled = v; },
  };
}

/** Seeds a goat with head + horn and selects the horn part. */
function seedGoat(state) {
  const head = mesh("tripo_part_1");
  const horn = mesh("tripo_part_9");
  state.nodeMeshes.clear();
  state.nodeMeshes.set("goat", [mesh("__root__", 0), head, horn]);
  state.pendingPartRemovals.clear();
  state.selectedNodeIds.clear();
  state.selectedNodeIds.add("goat");
  state.highlightedNodeId = "goat";
  state.highlightedSubMeshName = "tripo_part_9";
  return { head, horn };
}

beforeEach(() => {
  resetModules();
  _pushUndoEntry.mockReset();
  _registerUndoApplier.mockReset();
  _selectNode.mockReset();
  _emit.mockReset();
});

describe("removeSelectedPart", () => {
  test("hides the part, stages it for Save, pushes undo, reselects the model", async () => {
    const { mod, state } = await loadModule();
    const { horn, head } = seedGoat(state);

    expect(mod.removeSelectedPart()).toBe(true);
    expect(horn.isEnabled()).toBe(false);
    expect(horn.isPickable).toBe(false);
    expect(head.isEnabled()).toBe(true);
    expect([...mod.getPendingPartRemovals().get("goat")]).toEqual(["tripo_part_9"]);
    expect(_pushUndoEntry).toHaveBeenCalledWith({
      type: "part",
      label: "Remove part",
      items: [{ nodeId: "goat", meshName: "tripo_part_9", before: true, after: false }],
    });
    expect(_selectNode).toHaveBeenCalledWith("goat");
    expect(_emit).toHaveBeenCalledWith("NODE_LIST_CHANGED", { nodeIds: ["goat"] });
  });

  test("does nothing without a selected part", async () => {
    const { mod, state } = await loadModule();
    seedGoat(state);
    state.highlightedSubMeshName = null;
    expect(mod.canRemoveSelectedPart()).toBe(false);
    expect(mod.removeSelectedPart()).toBe(false);
    expect(_pushUndoEntry).not.toHaveBeenCalled();
  });

  test("refuses to remove a model's last visible part", async () => {
    const { mod, state } = await loadModule();
    seedGoat(state);
    expect(mod.removeSelectedPart()).toBe(true);
    // Only the head is left; selecting it can't remove it.
    state.highlightedSubMeshName = "tripo_part_1";
    expect(mod.canRemoveSelectedPart()).toBe(false);
  });

  test("undo restores the part and unstages it; redo removes it again", async () => {
    const { mod, state } = await loadModule();
    const { horn } = seedGoat(state);
    mod.removeSelectedPart();
    const [type, applier] = _registerUndoApplier.mock.calls[0];
    expect(type).toBe("part");
    const item = _pushUndoEntry.mock.calls[0][0].items[0];

    applier(item, "before");
    expect(horn.isEnabled()).toBe(true);
    expect(mod.getPendingPartRemovals().size).toBe(0);

    applier(item, "after");
    expect(horn.isEnabled()).toBe(false);
    expect(mod.getPendingPartRemovals().get("goat").has("tripo_part_9")).toBe(true);
  });
});
