/**
 * @jest-environment jsdom
 *
 * Multi-select semantics in scene-selection.js: the selection set, primary
 * (highlightedNodeId) tracking, highlight fan-out, and event emission.
 */
import { jest, expect, test, describe, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import { on, EVENTS } from "../../frontend/src/js/events/bus.js";
import {
  selectNode,
  toggleNodeSelection,
  selectAllNodes,
  selectSubMesh,
  deselectAll,
} from "../../frontend/src/js/engine/scene-selection.js";

function collectEvents() {
  const log = [];
  const offs = [
    on(EVENTS.NODE_SELECTED, (e) => log.push(["selected", e.nodeId])),
    on(EVENTS.NODE_DESELECTED, () => log.push(["deselected"])),
    on(EVENTS.SELECTION_CHANGED, (e) => log.push(["changed", e.nodeIds])),
    on(EVENTS.SUBMESH_SELECTED, (e) => log.push(["submesh", e.nodeId, e.meshName])),
  ];
  return { log, done: () => offs.forEach((off) => off()) };
}

beforeEach(() => {
  global.BABYLON = { Color3: { FromHexString: () => ({}) } };
  state.highlightLayer = { addMesh: jest.fn(), removeMesh: jest.fn() };
  state.nodeMeshes = new Map();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
  state.selectedNodeIds = new Set();
  for (const id of ["a", "b", "c"]) {
    state.nodeMeshes.set(id, [{ isDisposed: () => false, name: `${id}-mesh` }]);
  }
});

afterEach(() => {
  state.highlightLayer = null;
  delete global.BABYLON;
});

describe("scene-selection multi-select", () => {
  test("selectNode collapses the selection to a single node", () => {
    const { log, done } = collectEvents();
    selectNode("a", null);
    toggleNodeSelection("b", null);
    selectNode("c", null);

    expect([...state.selectedNodeIds]).toEqual(["c"]);
    expect(state.highlightedNodeId).toBe("c");
    expect(log).toContainEqual(["changed", ["c"]]);
    done();
  });

  test("toggle adds nodes and tracks the last-added as primary", () => {
    collectEvents();
    selectNode("a", null);
    toggleNodeSelection("b", null);

    expect([...state.selectedNodeIds]).toEqual(["a", "b"]);
    expect(state.highlightedNodeId).toBe("b");
    // Both nodes' meshes are highlighted.
    expect(state.highlightLayer.addMesh).toHaveBeenCalledTimes(2);
  });

  test("removing the primary promotes the last remaining node", () => {
    const { log, done } = collectEvents();
    selectNode("a", null);
    toggleNodeSelection("b", null);
    toggleNodeSelection("b", null); // remove primary

    expect([...state.selectedNodeIds]).toEqual(["a"]);
    expect(state.highlightedNodeId).toBe("a");
    expect(log).toContainEqual(["selected", "a"]);
    expect(log).toContainEqual(["changed", ["a"]]);
    done();
  });

  test("removing the last node emits deselected", () => {
    const { log, done } = collectEvents();
    selectNode("a", null);
    toggleNodeSelection("a", null);

    expect(state.selectedNodeIds.size).toBe(0);
    expect(state.highlightedNodeId).toBeNull();
    expect(log).toContainEqual(["deselected"]);
    expect(log).toContainEqual(["changed", []]);
    done();
  });

  test("removing a non-primary node keeps the primary", () => {
    const { log, done } = collectEvents();
    selectNode("a", null);
    toggleNodeSelection("b", null);
    toggleNodeSelection("c", null);
    toggleNodeSelection("b", null); // remove middle, non-primary

    expect([...state.selectedNodeIds]).toEqual(["a", "c"]);
    expect(state.highlightedNodeId).toBe("c");
    // No spurious re-selection of the primary.
    expect(log.filter(([kind]) => kind === "selected").at(-1)).toEqual([
      "selected",
      "c",
    ]);
    done();
  });

  test("selectAllNodes selects everything with the last id as primary", () => {
    selectAllNodes(["a", "b", "c"]);

    expect([...state.selectedNodeIds]).toEqual(["a", "b", "c"]);
    expect(state.highlightedNodeId).toBe("c");
    expect(state.highlightLayer.addMesh).toHaveBeenCalledTimes(3);
  });

  test("deselectAll clears the set and all highlights", () => {
    const { log, done } = collectEvents();
    selectAllNodes(["a", "b", "c"]);
    deselectAll();

    expect(state.selectedNodeIds.size).toBe(0);
    expect(state.highlightedNodeId).toBeNull();
    expect(state.highlightLayer.removeMesh).toHaveBeenCalledTimes(3);
    expect(log).toContainEqual(["deselected"]);
    done();
  });

  test("selectSubMesh collapses a multi-selection to that node", () => {
    selectNode("a", null);
    toggleNodeSelection("b", null);
    selectSubMesh("b", "b-mesh");

    expect([...state.selectedNodeIds]).toEqual(["b"]);
    expect(state.highlightedNodeId).toBe("b");
    expect(state.highlightedSubMeshName).toBe("b-mesh");
  });

  test("re-selecting the only selected node is a no-op", () => {
    const { log, done } = collectEvents();
    selectNode("a", null);
    const eventsAfterFirst = log.length;
    selectNode("a", null);

    expect(log.length).toBe(eventsAfterFirst);
    done();
  });
});
