/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeEach, beforeAll } from "@jest/globals";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import {
  assetState,
  _resetForTesting,
} from "../../frontend/src/js/state/asset-state.js";

let _resetSubscribers;

let store;
beforeAll(async () => {
  store = await import(
    "../../frontend/src/js/state/version-history-store.js"
  );
  _resetSubscribers = store._resetSubscribers;
});

const ENTRIES = [
  { cid: "cid-v1", version: 1, name: "T", nodeCount: 1, timestamp: null,
    nodes: { "node-a": "snap-a1" } },
  { cid: "cid-v2", version: 2, name: "T", nodeCount: 2, timestamp: null,
    nodes: { "node-a": "snap-a1", "node-b": "snap-b1" } },
  { cid: "cid-v3", version: 3, name: "T", nodeCount: 2, timestamp: null,
    nodes: { "node-a": "snap-a2", "node-b": "snap-b1" } },
];

function stubDeps(overrides = {}) {
  store._deps.walkChain = jest.fn(async () => ENTRIES);
  store._deps.fetchPublishedCid = jest.fn(async () => "cid-v2");
  store._deps.clearScene = jest.fn(async () => {});
  store._deps.loadAssetManifest = jest.fn(async () => {});
  Object.assign(store._deps, overrides);
}

// Let the store's async _refresh settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("version-history-store", () => {
  beforeEach(async () => {
    _resetForTesting();
    stubDeps();
    global.alert = jest.fn();
    _resetSubscribers(); // stop leaked subscribers before emitting reset
    emit(EVENTS.SCENE_EMPTY); // reset store state between tests
    await flush();
  });

  test("SCENE_READY populates entries and notifies subscribers", async () => {
    const seen = [];
    const unsub = store.subscribe((s) => seen.push(s));

    assetState.set({ activeAssetManifestCid: "cid-v3", activeAssetTokenId: 1 });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    const s = store.getState();
    expect(s.entries).toHaveLength(3);
    expect(s.activeCid).toBe("cid-v3");
    expect(s.publishedCid).toBe("cid-v2");
    expect(store.activeIndex()).toBe(2);
    expect(seen.length).toBeGreaterThan(0);
    unsub();
  });

  test("SCENE_EMPTY clears everything", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    emit(EVENTS.SCENE_EMPTY);
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().activeCid).toBe(null);
  });

  test("loadVersion clears scene, preserves latest CID, loads target", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    await store.loadVersion("cid-v1");

    expect(store._deps.clearScene).toHaveBeenCalled();
    expect(store._deps.loadAssetManifest).toHaveBeenCalledWith("cid-v1");
    // Chain root (latest) survives the clearScene reset.
    expect(assetState.get().latestAssetManifestCid).toBe("cid-v3");
    expect(store.getState().activeCid).toBe("cid-v1");
    expect(store.getState().isLoading).toBe(false);
  });

  test("loadVersion failure alerts and reverts activeCid", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    store._deps.loadAssetManifest = jest.fn(async () => {
      throw new Error("ipfs down");
    });
    await store.loadVersion("cid-v1");

    expect(global.alert).toHaveBeenCalled();
    expect(store.getState().activeCid).toBe("cid-v3");
    expect(store.getState().isLoading).toBe(false);
  });

  test("versionsForNode: first appearance + changes only", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    // node-a: appears v1, unchanged v2, changed v3 → [v1, v3]
    expect(store.versionsForNode("node-a").map((e) => e.version)).toEqual([1, 3]);
    // node-b: appears v2, unchanged v3 → [v2]
    expect(store.versionsForNode("node-b").map((e) => e.version)).toEqual([2]);
    // unknown node → []
    expect(store.versionsForNode("nope")).toEqual([]);
  });
});
