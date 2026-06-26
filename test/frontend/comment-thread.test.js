/** @jest-environment jsdom */
import { jest, describe, beforeEach, afterEach, test, expect } from "@jest/globals";

async function loadThreadModule(wallet = {}, asset = {}) {
  jest.resetModules();

  const emitMock = jest.fn();
  const EVENTS_MOCK = {
    COMMENT_THREAD_CHANGE: "commentThread:change",
    COMMENT_THREAD_STATUS: "commentThread:status",
  };

  jest.unstable_mockModule("../../frontend/src/js/events/bus.js", () => ({
    __esModule: true,
    emit: emitMock,
    EVENTS: EVENTS_MOCK,
  }));

  jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
    __esModule: true,
    walletState: { get: () => wallet },
  }));

  jest.unstable_mockModule("../../frontend/src/js/state/asset-state.js", () => ({
    __esModule: true,
    assetState: { get: () => asset },
  }));

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    __esModule: true,
    getFromRemoteIPFS: jest.fn(),
  }));

  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    __esModule: true,
    getCachedSession: jest.fn(() => null),
    clearSession: jest.fn(),
    createSession: jest.fn(),
  }));

  jest.unstable_mockModule("../../frontend/src/js/services/team.js", () => ({
    __esModule: true,
    fetchEditors: jest.fn().mockResolvedValue([]),
    getEditorSetVersion: jest.fn().mockResolvedValue(1),
  }));

  jest.unstable_mockModule("../../frontend/src/js/gltf/merkle-editors.js", () => ({
    __esModule: true,
    getProof: jest.fn(() => null),
  }));

  const mod = await import("../../frontend/src/js/state/comment-thread.js");
  return { CommentThread: mod.CommentThread, emitMock, EVENTS: EVENTS_MOCK };
}

describe("CommentThread", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("starts empty and disconnected", async () => {
    const { CommentThread } = await loadThreadModule();
    const thread = new CommentThread();

    expect(thread.events).toEqual([]);
    expect(thread.status.connected).toBe(false);
    expect(thread.status.connecting).toBe(false);
  });

  test("ingest adds events in created_at order and dedups by id", async () => {
    const { CommentThread, emitMock, EVENTS } = await loadThreadModule();
    const thread = new CommentThread();

    const a = { id: "a", created_at: 200 };
    const b = { id: "b", created_at: 100 };

    expect(thread.ingest(a)).toBe(true);
    expect(thread.ingest(a)).toBe(false);
    expect(thread.ingest(b)).toBe(true);

    expect(thread.events).toEqual([b, a]);
    expect(emitMock).toHaveBeenCalledWith(EVENTS.COMMENT_THREAD_CHANGE, {
      events: thread.events,
      source: "live",
      event: b,
    });
  });

  test("loadArchive merges archived events with source archive", async () => {
    const { CommentThread, emitMock, EVENTS } = await loadThreadModule();
    const thread = new CommentThread();

    const archived = [
      { id: "x", created_at: 10 },
      { id: "y", created_at: 20 },
    ];

    const { getFromRemoteIPFS } = await import(
      "../../frontend/src/js/ipfs/remote-ipfs.js"
    );
    getFromRemoteIPFS.mockResolvedValue({ events: archived });

    await thread.loadArchive("bafyArchive");

    expect(thread.events).toHaveLength(2);
    expect(emitMock).toHaveBeenCalledWith(EVENTS.COMMENT_THREAD_CHANGE, {
      events: expect.any(Array),
      source: "archive",
      event: archived[0],
    });
  });

  test("setContext clears events on token/asset change and loads archive", async () => {
    const { CommentThread, emitMock, EVENTS } = await loadThreadModule(
      {},
      { activeAssetManifestCid: "QmManifest", currentManifest: null, activeAssetId: "asset_1" }
    );
    const thread = new CommentThread();

    const { getFromRemoteIPFS } = await import(
      "../../frontend/src/js/ipfs/remote-ipfs.js"
    );
    getFromRemoteIPFS.mockResolvedValue({
      asset_id: "asset_1",
      comments_archive_cid: "bafyOld",
      events: [{ id: "old", created_at: 1 }],
    });

    await thread.setContext({
      tokenId: "1",
      chainId: "31337",
      assetId: "asset_1",
      manifest: null,
    });

    expect(thread.status.tokenId).toBe("1");
    expect(thread.status.assetId).toBe("asset_1");
    expect(thread.events).toHaveLength(1);

    await thread.setContext({
      tokenId: "1",
      chainId: "31337",
      assetId: "asset_2",
      manifest: { asset_id: "asset_2", comments_archive_cid: "bafyNew" },
    });

    expect(thread.status.assetId).toBe("asset_2");
    expect(getFromRemoteIPFS).toHaveBeenCalledWith("bafyNew");
  });

  test("disconnect clears reconnect timer without throwing", async () => {
    const { CommentThread } = await loadThreadModule();
    const thread = new CommentThread();

    thread.disconnect();
    expect(thread.status.connected).toBe(false);
  });

  test("post returns false when socket is closed", async () => {
    const { CommentThread } = await loadThreadModule();
    const thread = new CommentThread();

    expect(thread.post("hello")).toBe(false);
  });
});
