/**
 * @jest-environment jsdom
 *
 * Child-asset unlink (TODO #18): removing a selected child_ref node stages the
 * removal (pendingChildRefRemovals for saved children, a pendingChildRefs
 * splice for unsaved ones), disposes the subtree, and pushes a "child_ref"
 * undo entry. Non-child selections are ignored.
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

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
  await jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    on: jest.fn(),
    EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  }));
  await jest.unstable_mockModule("@arbesk/asset-core/domain/asset.js", () => ({
    getCurrentManifest: _getCurrentManifest,
  }));
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/transforms.js",
    () => ({
      getManifestNodes: (m) => m?.scene?.nodes || [],
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({
      disposeNodeSubtree: _disposeNodeSubtree,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-loader.js",
    () => ({
      loadNode: _loadNode,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-selection.js",
    () => ({
      deselectNodes: _deselectNodes,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/undo-stack.js",
    () => ({
      pushUndoEntry: _pushUndoEntry,
    })
  );
  await jest.unstable_mockModule(
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
  jest.resetModules();
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
