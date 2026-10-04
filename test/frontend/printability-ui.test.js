// @test-env dom
import { beforeAll, beforeEach, expect, jest, mock, test } from "bun:test";

const state = { cid: "bafyA", meshes: [] };

await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
  getAssetState: () => ({ activeAssetManifestCid: state.cid }),
}));
await mock.module("../../frontend/src/js/engine/transforms.js", () => ({
  getRenderableMeshes: (m) => m,
}));
await mock.module("../../frontend/src/js/ui/toasts.js", () => ({
  showToast: jest.fn(),
}));

let mod, bus;

const CUBE = {
  metadata: {},
  getVerticesData: () => [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ],
  getIndices: () => [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
  ],
};

await mock.module("../../frontend/src/js/engine/state.js", () => ({
  state: { get scene() { return { meshes: state.meshes }; } },
}));

beforeAll(async () => {
  mod = await import("../../frontend/src/js/ui/printability.js");
  bus = await import("@arbesk/asset-core/events/bus.js");
});

beforeEach(() => {
  state.cid = "bafyA";
  state.meshes = [];
  document.body.innerHTML = `
    <button id="printCheckBtn" hidden></button>
    <span id="printBadge" hidden></span>`;
  mod.initPrintability();
});

test("cube scene → Print-ready badge", () => {
  state.meshes = [CUBE];
  document.getElementById("printCheckBtn").click();
  const badge = document.getElementById("printBadge");
  expect(badge.hidden).toBe(false);
  expect(badge.textContent).toBe("Print-ready");
  expect(badge.classList.contains("print-badge-ok")).toBe(true);
});

test("open scene → Not watertight with open-edge count", () => {
  state.meshes = [{
    metadata: {},
    getVerticesData: () => [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    getIndices: () => [0, 1, 2, 0, 2, 3],
  }];
  document.getElementById("printCheckBtn").click();
  const badge = document.getElementById("printBadge");
  expect(badge.textContent).toBe("Not watertight · 4 open edges");
  expect(badge.classList.contains("print-badge-warn")).toBe(true);
});

test("badge resets when the scene clears and button hides with no asset", () => {
  state.meshes = [CUBE];
  document.getElementById("printCheckBtn").click();
  expect(document.getElementById("printBadge").hidden).toBe(false);
  bus.emit(bus.EVENTS.SCENE_CLEARED, {});
  expect(document.getElementById("printBadge").hidden).toBe(true);
  state.cid = null;
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
  expect(document.getElementById("printCheckBtn").hidden).toBe(true);
});
