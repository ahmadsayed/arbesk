/**
 * @jest-environment jsdom
 */
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/registry.js";

beforeEach(() => _resetForTesting());

describe("assetState.get()", () => {
  test("returns null defaults", () => {
    expect(assetState.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
    });
  });

  test("returns a snapshot copy, not the live object", () => {
    const snap1 = assetState.get();
    assetState.set({ activeAssetName: "hello" });
    expect(snap1.activeAssetName).toBeNull();
  });
});

describe("assetState.set()", () => {
  test("merges partial update", () => {
    assetState.set({ activeAssetName: "Cube" });
    expect(assetState.get().activeAssetName).toBe("Cube");
    expect(assetState.get().activeAssetTokenId).toBeNull();
  });

  test("emits ASSET_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = ({ detail }) => {
        off(EVENTS.ASSET_STATE_CHANGED, handler);
        expect(detail.activeAssetName).toBe("Cube");
        expect(detail.activeAssetTokenId).toBeNull();
        resolve();
      };
      on(EVENTS.ASSET_STATE_CHANGED, handler);
      assetState.set({ activeAssetName: "Cube" });
    });
  });
});

describe("assetState.reset()", () => {
  test("restores all fields to null", () => {
    assetState.set({ activeAssetName: "Cube", activeAssetTokenId: "42" });
    assetState.reset();
    expect(assetState.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
    });
  });

  test("emits ASSET_STATE_CHANGED after reset", () => {
    return new Promise((resolve) => {
      assetState.set({ activeAssetName: "Cube" });
      const handler = ({ detail }) => {
        off(EVENTS.ASSET_STATE_CHANGED, handler);
        expect(detail.activeAssetName).toBeNull();
        resolve();
      };
      on(EVENTS.ASSET_STATE_CHANGED, handler);
      assetState.reset();
    });
  });
});
