/**
 * @jest-environment jsdom
 *
 * saveDraftAsset: name resolution, URL update ordering, ASSET_DRAFT_SAVED
 * emission. IO deps injected; real assetStore + real event bus.
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import { saveDraftAsset } from "../../frontend/src/js/asset-core/domain/asset.js";
import { assetStore, _resetForTesting } from "../../frontend/src/js/asset-core/domain/asset-store.js";
import { on, EVENTS } from "../../frontend/src/js/asset-core/events/bus.js";

function makeDeps(over = {}) {
  return {
    saveDraft: jest.fn().mockResolvedValue({ ok: true, cid: "bafyNew", manifest: { asset_id: "a1" } }),
    fetchTokenName: jest.fn().mockResolvedValue("On-Chain Name"),
    updateUrlManifest: jest.fn(),
    ...over,
  };
}

beforeEach(() => _resetForTesting());

test("in-session name wins; save runs; URL updated and event emitted for drafts", async () => {
  assetStore.set({ activeAssetName: "Session Name" });
  const deps = makeDeps();
  const seen = [];
  const unsub = on(EVENTS.ASSET_DRAFT_SAVED, (e) => seen.push(e.cid));

  const result = await saveDraftAsset(deps);

  expect(deps.saveDraft).toHaveBeenCalledWith("Session Name");
  expect(deps.fetchTokenName).not.toHaveBeenCalled();
  expect(deps.updateUrlManifest).toHaveBeenCalledWith("bafyNew");
  expect(seen).toEqual(["bafyNew"]);
  expect(result.ok).toBe(true);
  unsub();
});

test("tokenized asset: name from chain, no URL manifest update", async () => {
  assetStore.set({ activeAssetTokenId: "7" });
  const deps = makeDeps();
  await saveDraftAsset(deps);
  expect(deps.fetchTokenName).toHaveBeenCalledWith("7");
  expect(deps.saveDraft).toHaveBeenCalledWith("On-Chain Name");
  expect(deps.updateUrlManifest).not.toHaveBeenCalled();
});

test("falls back to My Asset when no name anywhere", async () => {
  const deps = makeDeps({ fetchTokenName: jest.fn().mockResolvedValue(null) });
  assetStore.set({ activeAssetTokenId: "7" });
  await saveDraftAsset(deps);
  expect(deps.saveDraft).toHaveBeenCalledWith("My Asset");

  _resetForTesting();
  await saveDraftAsset(deps);
  expect(deps.saveDraft).toHaveBeenLastCalledWith("My Asset");
});

test("not-ok results pass through with no URL write and no event", async () => {
  const deps = makeDeps({
    saveDraft: jest.fn().mockResolvedValue({ ok: false, reason: "no-changes", cid: "bafyOld" }),
  });
  const seen = [];
  const unsub = on(EVENTS.ASSET_DRAFT_SAVED, (e) => seen.push(e));
  const result = await saveDraftAsset(deps);
  expect(result).toEqual({ ok: false, reason: "no-changes", cid: "bafyOld" });
  expect(deps.updateUrlManifest).not.toHaveBeenCalled();
  expect(seen).toEqual([]);
  unsub();
});

test("save failures propagate (the UI owns the toast)", async () => {
  const deps = makeDeps({ saveDraft: jest.fn().mockRejectedValue(new Error("HTTP 429")) });
  await expect(saveDraftAsset(deps)).rejects.toThrow("HTTP 429");
});
