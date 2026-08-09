/**
 * @jest-environment jsdom
 *
 * publishAsset: republish auth fail-fast, publishContext, no-changes still
 * anchors, assetID derivation, identity adoption, ASSET_PUBLISHED emission,
 * progress/status hook sequencing. IO deps injected; real assetState + bus.
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import { publishAsset } from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/bus.js";

const WALLET = { address: "0xOwner", chainId: 31337, contractAddress: "0xC" };

function makeDeps(over = {}) {
  return {
    verifyCanEdit: jest.fn().mockResolvedValue(undefined),
    saveDraft: jest.fn().mockResolvedValue({
      ok: true,
      cid: "bafyAsset",
      manifest: { asset_id: "asset_1" },
    }),
    publishCollection: jest.fn().mockResolvedValue({ tokenId: "123", isNew: false }),
    updateUrlAsset: jest.fn(),
    onNewCollection: jest.fn(),
    onStatus: jest.fn(),
    onProgress: jest.fn(),
    ...over,
  };
}

beforeEach(() => _resetForTesting());

test("first publish: no verifyCanEdit, identity adopted, event emitted", async () => {
  const deps = makeDeps({ publishCollection: jest.fn().mockResolvedValue({ tokenId: "123", isNew: true }) });
  const seen = [];
  const unsub = on(EVENTS.ASSET_PUBLISHED, (e) => seen.push(e));

  const out = await publishAsset("My Hat", WALLET, deps);

  expect(deps.verifyCanEdit).not.toHaveBeenCalled();
  expect(deps.saveDraft).toHaveBeenCalledWith("My Hat", {
    captureThumbnail: true,
    publishContext: null,
  });
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyAsset", "asset_1", "0xOwner");
  expect(deps.updateUrlAsset).toHaveBeenCalledWith("123");
  expect(deps.onNewCollection).toHaveBeenCalled();
  expect(seen).toEqual([{ tokenId: "123", cid: "bafyAsset" }]);
  expect(out).toEqual({ outcome: "published", tokenId: "123", cid: "bafyAsset", isNew: true });
  const s = assetState.get();
  expect(s.activeAssetTokenId).toBe("123");
  expect(s.activeCollectionTokenId).toBe("123");
  expect(s.activeAssetId).toBe("asset_1");
  unsub();
});

test("republish: verifyCanEdit fail-fast with publishContext", async () => {
  assetState.set({ activeAssetTokenId: "55", activeAssetId: "asset_9" });
  const deps = makeDeps();
  const out = await publishAsset("Hat", WALLET, deps);
  expect(deps.verifyCanEdit).toHaveBeenCalledWith("55", "0xOwner");
  expect(deps.saveDraft).toHaveBeenCalledWith("Hat", {
    captureThumbnail: true,
    publishContext: { tokenId: "55", chainId: 31337, contractAddress: "0xC" },
  });
  // Existing assetId reused, not re-derived from the manifest.
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyAsset", "asset_9", "0xOwner");
  expect(deps.onNewCollection).not.toHaveBeenCalled(); // isNew: false
  expect(out.outcome).toBe("published");
});

test("no-changes save still anchors the collection", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({
      ok: false, reason: "no-changes", cid: "bafyExisting", manifest: { asset_id: "asset_1" },
    }),
  });
  const out = await publishAsset("Hat", WALLET, deps);
  expect(deps.publishCollection).toHaveBeenCalledWith("bafyExisting", "asset_1", "0xOwner");
  expect(out.outcome).toBe("published");
});

test("empty save aborts before any chain work", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({ ok: false, reason: "empty" }),
  });
  const out = await publishAsset("Hat", WALLET, deps);
  expect(out).toEqual({ outcome: "empty" });
  expect(deps.publishCollection).not.toHaveBeenCalled();
  expect(deps.updateUrlAsset).not.toHaveBeenCalled();
});

test("progress/status hooks fire in the legacy order", async () => {
  const calls = [];
  const deps = makeDeps({
    onStatus: jest.fn((msg) => calls.push(["status", msg])),
    onProgress: jest.fn((f, _msg) => calls.push(["progress", f])),
  });
  await publishAsset("Hat", WALLET, deps);
  expect(calls).toEqual([
    ["progress", 0.3],
    ["status", "Confirm transaction in MetaMask…"],
    ["progress", 0.6],
    ["progress", 0.9],
  ]);
});

test("failures propagate (rate-limit handling stays in the UI)", async () => {
  const deps = makeDeps({
    publishCollection: jest.fn().mockRejectedValue(new Error("HTTP 429")),
  });
  await expect(publishAsset("Hat", WALLET, deps)).rejects.toThrow("HTTP 429");
});
