// @test-env dom
/**
 * Child-asset unlink (TODO #18): removing a selected child_ref node stages the
 * removal (pendingChildRefRemovals for saved children, a pendingChildRefs
 * splice for unsaved ones), disposes the subtree, and pushes a "child_ref"
 * undo entry. Non-child selections are ignored.
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
const CHILD_A = {
  node_id: "childA",
  child_ref: { collection: { chainId: 31337, contractAddress: "0x1", tokenId: "1" }, assetID: "a" },
};
const CHILD_B = {
  node_id: "childB",
  child_ref: { collection: { chainId: 31337, contractAddress: "0x1", tokenId: "2" }, assetID: "b" },
};
const REGULAR = { node_id: "regular", source: { cid: "bafyRegular" } };

const _pushUndoEntry = jest.fn();
const _registerUndoApplier = jest.fn();
const _disposeNodeSubtree = jest.fn();
const _deselectNodes = jest.fn();
const _loadNode = jest.fn().mockResolvedValue({ anchor: {}, meshes: [] });
const _getCurrentManifest = jest.fn();

function setManifestNodes(nodes) {
  _getCurrentManifest.mockImplementation(() => ({ scene: { nodes } }));
}

async function loadModule() {
  await mock.module("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    on: jest.fn(),
    EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  }));
  await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
    getCurrentManifest: _getCurrentManifest,
  }));
  await mock.module(
    "../../frontend/src/js/engine/transforms.js",
    () => ({
      getManifestNodes: (m) => m?.scene?.nodes || [],
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({
      disposeNodeSubtree: _disposeNodeSubtree,
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/scene-loader.js",
    () => ({
      loadNode: _loadNode,
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/scene-selection.js",
    () => ({
      deselectNodes: _deselectNodes,
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/undo-stack.js",
    () => ({
      pushUndoEntry: _pushUndoEntry,
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/undo-controller.js",
    () => ({
      registerUndoApplier: _registerUndoApplier,
    })
  );

  const mod = await import("../../frontend/src/js/engine/child-remove.js");
  const { state } = await import("../../frontend/src/js/engine/state.js");
  return { mod, state };
}

beforeEach(() => {
  resetModules();
  _pushUndoEntry.mockReset();
  _registerUndoApplier.mockReset();
  _disposeNodeSubtree.mockReset();
  _deselectNodes.mockReset();
  _loadNode.mockReset();
  _loadNode.mockResolvedValue({ anchor: {}, meshes: [] });
  _getCurrentManifest.mockReset();
});

describe("collectRemovableChildIds", () => {
  test("pure filter keeps only child ids in selection order", async () => {
    const { mod } = await loadModule();
    expect(
      mod.collectRemovableChildIds(["a", "b", "c", "a"], ["c", "a"])
    ).toEqual(["a", "c", "a"]);
    expect(mod.collectRemovableChildIds(["x"], [])).toEqual([]);
  });
});

describe("removeChildAssetNodes", () => {
  test("unlinks only selected child assets (saved) and stages the removal", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([CHILD_A, CHILD_B, REGULAR]);
    state.pendingChildRefs = [];

    mod.removeChildAssetNodes(["childA", "regular"]);

    expect(state.pendingChildRefRemovals.has("childA")).toBe(true);
    expect(state.pendingChildRefRemovals.has("regular")).toBe(false);
    expect(_disposeNodeSubtree).toHaveBeenCalledWith("childA");
    expect(_disposeNodeSubtree).not.toHaveBeenCalledWith("regular");
    expect(_deselectNodes).toHaveBeenCalledWith(["childA"]);

    expect(_pushUndoEntry).toHaveBeenCalledTimes(1);
    const entry = _pushUndoEntry.mock.calls[0][0];
    expect(entry.type).toBe("child_ref");
    expect(entry.label).toBe("Unlink child");
    expect(entry.items).toEqual([
      { nodeId: "childA", before: { node: CHILD_A, fromPending: false }, after: null },
    ]);
  });

  test("unsaved (pending) children are spliced from pendingChildRefs", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([REGULAR]);
    state.pendingChildRefs = [{ node_id: "pendingChild", child_ref: CHILD_A.child_ref }];

    mod.removeChildAssetNodes(["pendingChild"]);

    expect(state.pendingChildRefs).toHaveLength(0);
    expect(state.pendingChildRefRemovals.has("pendingChild")).toBe(false);
    expect(_disposeNodeSubtree).toHaveBeenCalledWith("pendingChild");

    const entry = _pushUndoEntry.mock.calls[0][0];
    expect(entry.items[0].before.fromPending).toBe(true);
  });

  test("selection with no child assets is a no-op", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([REGULAR]);
    state.pendingChildRefs = [];

    mod.removeChildAssetNodes(["regular"]);

    expect(_pushUndoEntry).not.toHaveBeenCalled();
    expect(_disposeNodeSubtree).not.toHaveBeenCalled();
    expect(state.pendingChildRefRemovals.size).toBe(0);
  });

  test("multi-select unlinks every selected child and labels the undo entry", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([CHILD_A, CHILD_B, REGULAR]);
    state.pendingChildRefs = [];

    mod.removeChildAssetNodes(["childA", "childB"]);

    expect(state.pendingChildRefRemovals.has("childA")).toBe(true);
    expect(state.pendingChildRefRemovals.has("childB")).toBe(true);
    const entry = _pushUndoEntry.mock.calls[0][0];
    expect(entry.label).toBe("Unlink children");
    expect(entry.items.map((i) => i.nodeId)).toEqual(["childA", "childB"]);
  });
});

describe("child_ref undo applier", () => {
  test("registers a child_ref applier that re-inserts on undo and re-removes on redo", async () => {
    const { state } = await loadModule();
    state.rootSceneAnchor = {}; // so reloadChildAssetNode proceeds
    setManifestNodes([CHILD_A, REGULAR]);

    expect(_registerUndoApplier).toHaveBeenCalled();
    const [type, applier] = _registerUndoApplier.mock.calls[0];
    expect(type).toBe("child_ref");

    const captured = { node: CHILD_A, fromPending: false };
    state.pendingChildRefRemovals.add("childA");

    // undo → re-insert: un-marks the removal and reloads the child
    applier({ nodeId: "childA", before: captured, after: null }, "before");
    expect(state.pendingChildRefRemovals.has("childA")).toBe(false);
    expect(_loadNode).toHaveBeenCalled();

    // redo → remove again
    applier({ nodeId: "childA", before: captured, after: null }, "after");
    expect(state.pendingChildRefRemovals.has("childA")).toBe(true);
    expect(_disposeNodeSubtree).toHaveBeenCalledWith("childA");
  });
});

describe("Insert a copy (pending fork node) unlink + undo", () => {
  const FORK = {
    node_id: "linked_7_lamp",
    transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    source: { cid: "bafyModel", path: "model.glb", format: "glb" },
  };

  test("a pending fork node (source, no child_ref) is unlinked with its own undo entry", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([REGULAR]);
    state.pendingChildRefs = [FORK];

    mod.removeChildAssetNodes([FORK.node_id]);

    expect(state.pendingChildRefs).toHaveLength(0);
    expect(_disposeNodeSubtree).toHaveBeenCalledWith(FORK.node_id);
    expect(_pushUndoEntry).toHaveBeenCalledTimes(1);
    const entry = _pushUndoEntry.mock.calls[0][0];
    expect(entry.type).toBe("child_ref");
    expect(entry.items).toEqual([
      { nodeId: FORK.node_id, before: { node: FORK, fromPending: true }, after: null },
    ]);
  });

  test("saved plain-geometry nodes stay non-removable", async () => {
    const { mod, state } = await loadModule();
    setManifestNodes([REGULAR]);
    state.pendingChildRefs = [FORK];

    mod.removeChildAssetNodes(["regular"]);

    expect(_pushUndoEntry).not.toHaveBeenCalled();
    expect(state.pendingChildRefs).toEqual([FORK]);
  });

  test("Ctrl+Z after unlinking a fork re-inserts and reloads it", async () => {
    const { mod, state } = await loadModule();
    state.rootSceneAnchor = {};
    setManifestNodes([REGULAR]);
    state.pendingChildRefs = [FORK];

    mod.removeChildAssetNodes([FORK.node_id]);
    const item = _pushUndoEntry.mock.calls[0][0].items[0];
    const applier = _registerUndoApplier.mock.calls[0][1];

    applier(item, "before");
    expect(state.pendingChildRefs).toEqual([FORK]);
    expect(_loadNode).toHaveBeenCalledWith(FORK, state.rootSceneAnchor, 0, expect.any(Set));

    applier(item, "after");
    expect(state.pendingChildRefs).toHaveLength(0);
  });
});
