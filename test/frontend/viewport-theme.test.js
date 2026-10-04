// @test-env dom
/**
 * Selection highlight follows the theme: the outline uses --selection, and
 * meshes already highlighted are re-coloured when THEME_CHANGED fires.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  selectNode,
  selectSubMesh,
  toggleNodeSelection,
  deselectAll,
} from "../../frontend/src/js/engine/scene-selection.js";

class Color3 {
  constructor(r, g, b) {
    Object.assign(this, { r, g, b });
  }
  static FromHexString() {
    return new Color3(0, 0, 0);
  }
}

/** "#rrggbb" → the Color3 hexToColor3 would build. */
const rgb = (hex) =>
  new Color3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

const setSelectionToken = (hex) =>
  document.documentElement.style.setProperty("--selection", hex);

beforeEach(() => {
  global.BABYLON = { Color3 };
  state.highlightLayer = { addMesh: jest.fn(), removeMesh: jest.fn() };
  state.nodeMeshes = new Map();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
  state.selectedNodeIds = new Set();
  for (const id of ["a", "b"]) {
    state.nodeMeshes.set(id, [
      { isDisposed: () => false, name: `${id}-1` },
      { isDisposed: () => false, name: `${id}-2` },
    ]);
  }
});

afterEach(() => {
  deselectAll();
  state.highlightLayer = null;
  document.documentElement.style.removeProperty("--selection");
  delete global.BABYLON;
});

describe("selection colour follows the theme", () => {
  test("highlights use the --selection token", () => {
    setSelectionToken("#a35a12");
    selectNode("a", null);
    const colours = state.highlightLayer.addMesh.mock.calls.map((c) => c[1]);
    expect(colours).toEqual([rgb("#a35a12"), rgb("#a35a12")]);
  });

  test("THEME_CHANGED re-colours every highlighted mesh", () => {
    setSelectionToken("#a35a12");
    selectNode("a", null);
    toggleNodeSelection("b", null);
    state.highlightLayer.addMesh.mockClear();

    setSelectionToken("#f0a64b");
    emit(EVENTS.THEME_CHANGED, { theme: "graphite", pref: "graphite" });

    const calls = state.highlightLayer.addMesh.mock.calls;
    expect(calls.map((c) => c[0].name).sort()).toEqual(["a-1", "a-2", "b-1", "b-2"]);
    expect(calls.every((c) => JSON.stringify(c[1]) === JSON.stringify(rgb("#f0a64b")))).toBe(true);
  });

  test("THEME_CHANGED keeps a sub-mesh selection to that sub-mesh", () => {
    setSelectionToken("#a35a12");
    selectSubMesh("a", "a-2");
    state.highlightLayer.addMesh.mockClear();

    emit(EVENTS.THEME_CHANGED, { theme: "paper", pref: "paper" });

    expect(state.highlightLayer.addMesh.mock.calls.map((c) => c[0].name)).toEqual(["a-2"]);
  });

  test("THEME_CHANGED with nothing selected adds nothing", () => {
    emit(EVENTS.THEME_CHANGED, { theme: "paper", pref: "paper" });
    expect(state.highlightLayer.addMesh).not.toHaveBeenCalled();
  });
});
