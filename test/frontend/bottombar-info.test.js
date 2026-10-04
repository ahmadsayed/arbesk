// @test-env dom
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";

const state = { manifest: null, cid: null };
const annotations = { pending: null };

await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
  getAssetState: () => ({ activeAssetManifestCid: state.cid }),
  getCurrentManifest: () => state.manifest,
}));
await mock.module(
  "../../frontend/src/js/services/asset-save/annotations.js",
  () => ({ getPendingAnnotations: () => annotations.pending })
);

let mod, bus;

beforeAll(async () => {
  mod = await import("../../frontend/src/js/ui/bottombar-info.js");
  bus = await import("@arbesk/asset-core/events/bus.js");
});

beforeEach(() => {
  state.manifest = null;
  state.cid = null;
  annotations.pending = null;
  document.body.innerHTML =
    '<span id="bottomBarAssetInfo" class="bottombar-status-item tabular" hidden></span>';
  mod.initBottombarInfo();
});

const el = () => document.getElementById("bottomBarAssetInfo");

function withAsset(manifest, pending = null) {
  state.cid = "bafyX";
  state.manifest = manifest;
  annotations.pending = pending;
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
}

test("hidden with no asset / no computed facts", () => {
  bus.emit(bus.EVENTS.ASSET_STATE_CHANGED, {});
  expect(el().hidden).toBe(true);
  withAsset({ metadata: {} });
  expect(el().hidden).toBe(true);
});

test("shows unit-aware dimensions and compact triangles", () => {
  withAsset({
    metadata: {
      computed: {
        dimensions: { width: 1.846, height: 0.62, depth: 0.5499, unit: "meters" },
        triangle_count: 12400,
      },
      annotations: {},
    },
  });
  expect(el().hidden).toBe(false);
  expect(el().textContent).toBe("1.85 × 0.62 × 0.55 m · 12.4k tris");
});

test("pending units annotation flips the display to mm", () => {
  withAsset(
    {
      metadata: {
        computed: {
          dimensions: { width: 0.085, height: 0.054, depth: 0.012, unit: "meters" },
          triangle_count: 500,
        },
        annotations: {},
      },
    },
    { units: "mm" }
  );
  expect(el().textContent).toBe("85 × 54 × 12 mm · 500 tris");
});
