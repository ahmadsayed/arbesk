// @test-env dom
import { beforeAll, beforeEach, describe, expect, jest, test } from "bun:test";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  assetStore,
  _resetForTesting,
} from "@arbesk/asset-core/domain/asset-store.js";

let _resetSubscribers;

let store;
beforeAll(async () => {
  store = await import(
    "@arbesk/asset-core/domain/version-history-store.js"
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

    assetStore.set({ activeAssetManifestCid: "cid-v3", activeAssetTokenId: 1 });
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
    assetStore.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    emit(EVENTS.SCENE_EMPTY);
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().activeCid).toBe(null);
  });

  test("loadVersion clears scene, preserves latest CID, loads target", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    await store.loadVersion("cid-v1");

    expect(store._deps.clearScene).toHaveBeenCalled();
    expect(store._deps.loadAssetManifest).toHaveBeenCalledWith("cid-v1");
    // Chain root (latest) survives the clearScene reset.
    expect(assetStore.get().latestAssetManifestCid).toBe("cid-v3");
    expect(store.getState().activeCid).toBe("cid-v1");
    expect(store.getState().isLoading).toBe(false);
  });

  test("loadVersion failure alerts and reverts activeCid", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3" });
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

  test("SCENE_CLEARED drops the previous asset's chain", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();
    expect(store.getState().entries).toHaveLength(3);

    emit(EVENTS.SCENE_CLEARED);

    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().activeCid).toBeNull();
    expect(store.getState().publishedCid).toBeNull();
  });

  test("a slower refresh from an older root cannot overwrite the newer chain", async () => {
    const resolvers = new Map();
    store._deps.walkChain = jest.fn(
      (cid) =>
        new Promise((resolve) => {
          resolvers.set(cid, resolve);
        })
    );

    // The deep link first advertises a collection manifest, then the real
    // asset resolves and re-roots the store.
    assetStore.set({ activeAssetManifestCid: "cid-collection" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-collection", manifest: {} });
    assetStore.set({ activeAssetManifestCid: "cid-asset" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-asset", manifest: {} });

    // The newer walk lands first…
    resolvers.get("cid-asset")?.([{ cid: "cid-asset" }]);
    await flush();
    // …and the older collection walk must be discarded, not applied last.
    resolvers.get("cid-collection")?.([{ cid: "cid-collection" }]);
    await flush();

    expect(store.getState().entries.map((e) => e.cid)).toEqual([
      "cid-asset",
    ]);
  });

  test("history navigation keeps the chain when the scene clear fires", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    let release;
    store._deps.loadAssetManifest = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const loading = store.loadVersion("cid-v1");
    // Let loadVersion's clearScene() settle so it is now awaiting the version
    // load; the engine's clearScene emits SCENE_CLEARED mid-navigation.
    await flush();
    emit(EVENTS.SCENE_CLEARED);
    expect(store.getState().entries).toHaveLength(3);

    release();
    await loading;

    expect(store.getState().entries).toHaveLength(3);
    expect(store.getState().activeCid).toBe("cid-v1");
  });

  test("wallet reconnect re-checks the loaded root, not a foreign active CID", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3", activeAssetTokenId: 1 });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    store._deps.walkChain = jest.fn(async () => ENTRIES);
    // A ?asset= deep link can leave the COLLECTION manifest CID in the active
    // slot while the asset is still resolving. WALLET_CONNECTED must not walk
    // that collection chain.
    assetStore.set({ activeAssetManifestCid: "cid-collection" });
    emit(EVENTS.WALLET_CONNECTED, {});

    await flush();

    expect(store._deps.walkChain).toHaveBeenCalledTimes(1);
    expect(store._deps.walkChain.mock.calls[0][0]).toBe("cid-v3");
    expect(store.getState().entries).toHaveLength(3);
  });

  test("draft save re-roots the chain at the new tip while scrubbing", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3", activeAssetTokenId: 1 });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    store._deps.walkChain = jest.fn(async () => ENTRIES);
    assetStore.set({
      activeAssetManifestCid: "cid-v1",
      latestAssetManifestCid: "cid-v4",
    });
    emit(EVENTS.ASSET_DRAFT_SAVED, { cid: "cid-v4" });

    await flush();

    expect(store._deps.walkChain.mock.calls[0][0]).toBe("cid-v4");
  });

  test("publish re-roots at the newly saved tip, not the old chain root", async () => {
    assetStore.set({ activeAssetManifestCid: "cid-v3", activeAssetTokenId: 1 });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    store._deps.walkChain = jest.fn(async () => ENTRIES);
    // Publishing saves a new version first; the chain root must follow it.
    assetStore.set({ latestAssetManifestCid: "cid-v4" });
    jest.useFakeTimers();
    emit(EVENTS.ASSET_PUBLISHED, {});
    jest.advanceTimersByTime(500);
    jest.useRealTimers();
    await flush();

    expect(store._deps.walkChain.mock.calls[0][0]).toBe("cid-v4");
  });
});
