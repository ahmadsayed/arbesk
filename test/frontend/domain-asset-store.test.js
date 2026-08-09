/**
 * @jest-environment jsdom
 */
import {
  assetStore,
  _resetForTesting,
} from "../../frontend/src/js/domain/asset-store.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

beforeEach(() => _resetForTesting());

describe("assetStore.get()", () => {
  test("returns null defaults", () => {
    expect(assetStore.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
      activeCollectionTokenId: null,
      activeAssetId: null,
      selectedCollectionId: null,
    });
  });

  test("returns a snapshot copy, not the live object", () => {
    const snap1 = assetStore.get();
    assetStore.set({ activeAssetName: "hello" });
    expect(snap1.activeAssetName).toBeNull();
  });
});

describe("assetStore.set()", () => {
  test("merges partial update", () => {
    assetStore.set({ activeAssetName: "Cube" });
    expect(assetStore.get().activeAssetName).toBe("Cube");
    expect(assetStore.get().activeAssetTokenId).toBeNull();
  });

  test("emits ASSET_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = (payload) => {
        off(EVENTS.ASSET_STATE_CHANGED, handler);
        expect(payload.activeAssetName).toBe("Cube");
        expect(payload.activeAssetTokenId).toBeNull();
        resolve();
      };
      on(EVENTS.ASSET_STATE_CHANGED, handler);
      assetStore.set({ activeAssetName: "Cube" });
    });
  });
});

describe("assetStore.reset()", () => {
  test("restores all fields to null", () => {
    assetStore.set({ activeAssetName: "Cube", activeAssetTokenId: "42" });
    assetStore.reset();
    expect(assetStore.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
      activeCollectionTokenId: null,
      activeAssetId: null,
      selectedCollectionId: null,
    });
  });

  test("emits ASSET_STATE_CHANGED after reset", () => {
    return new Promise((resolve) => {
      assetStore.set({ activeAssetName: "Cube" });
      const handler = (payload) => {
        off(EVENTS.ASSET_STATE_CHANGED, handler);
        expect(payload.activeAssetName).toBeNull();
        resolve();
      };
      on(EVENTS.ASSET_STATE_CHANGED, handler);
      assetStore.reset();
    });
  });
});
