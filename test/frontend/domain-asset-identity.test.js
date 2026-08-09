/**
 * @jest-environment jsdom
 *
 * Domain asset identity/CID commands: the only writers of
 * activeAssetManifestCid / latestAssetManifestCid / activeAssetTokenId /
 * activeAssetId / currentManifest.
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  adoptOpenedAsset,
  activateAssetManifest,
  setActiveManifestCid,
  setLatestManifestCid,
  clearAssetManifestCids,
  cacheCurrentManifest,
  recordSavedVersion,
  adoptPublishedIdentity,
} from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("adoptOpenedAsset sets active+latest and only the identity keys present", () => {
  assetState.set({ activeAssetTokenId: "9", selectedCollectionId: "3" });
  adoptOpenedAsset("bafyCid");
  let s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyCid");
  expect(s.latestAssetManifestCid).toBe("bafyCid");
  expect(s.activeAssetTokenId).toBe("9"); // untouched
  expect(s.selectedCollectionId).toBe("3"); // untouched

  adoptOpenedAsset("bafyOther", {
    tokenId: "7",
    assetId: "asset_1",
  });
  s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyOther");
  expect(s.latestAssetManifestCid).toBe("bafyOther");
  expect(s.activeAssetTokenId).toBe("7");
  expect(s.activeAssetId).toBe("asset_1");
  expect(s.selectedCollectionId).toBe("3"); // untouched
});

test("adoptOpenedAsset only writes asset identity fields, not collection context", () => {
  assetState.set({ activeCollectionTokenId: "9", selectedCollectionId: "3" });
  adoptOpenedAsset("bafyOther", {
    tokenId: "7",
    assetId: "asset_1",
  });
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyOther");
  expect(s.latestAssetManifestCid).toBe("bafyOther");
  expect(s.activeAssetTokenId).toBe("7");
  expect(s.activeAssetId).toBe("asset_1");
  expect(s.activeCollectionTokenId).toBe("9"); // untouched
  expect(s.selectedCollectionId).toBe("3"); // untouched
});

test("adoptOpenedAsset writes an explicit null tokenId (key present)", () => {
  assetState.set({ activeAssetTokenId: "9" });
  adoptOpenedAsset("bafyX", { tokenId: null });
  expect(assetState.get().activeAssetTokenId).toBeNull();
});

test("activateAssetManifest sets active + tagged currentManifest, not latest", () => {
  assetState.set({ latestAssetManifestCid: "bafyTip" });
  activateAssetManifest("bafyV2", { asset_id: "a1", version: 2 });
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBe("bafyV2");
  expect(s.latestAssetManifestCid).toBe("bafyTip"); // chain tip survives
  expect(s.currentManifest._manifestCid).toBe("bafyV2");
  expect(s.currentManifest.version).toBe(2);
});

test("setActiveManifestCid / setLatestManifestCid are single-field", () => {
  assetState.set({ activeAssetManifestCid: "a", latestAssetManifestCid: "l" });
  setActiveManifestCid("a2");
  expect(assetState.get().activeAssetManifestCid).toBe("a2");
  expect(assetState.get().latestAssetManifestCid).toBe("l");
  setLatestManifestCid(null);
  expect(assetState.get().latestAssetManifestCid).toBeNull();
  expect(assetState.get().activeAssetManifestCid).toBe("a2");
});

test("clearAssetManifestCids nulls active + latest only", () => {
  assetState.set({
    activeAssetManifestCid: "a",
    latestAssetManifestCid: "l",
    activeAssetTokenId: "7",
  });
  clearAssetManifestCids();
  const s = assetState.get();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.latestAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBe("7");
});

test("cacheCurrentManifest tags and stores only currentManifest", () => {
  assetState.set({ activeAssetManifestCid: "bafyA" });
  cacheCurrentManifest({ asset_id: "a1" }, "bafyA");
  const s = assetState.get();
  expect(s.currentManifest._manifestCid).toBe("bafyA");
  expect(s.activeAssetManifestCid).toBe("bafyA");
});

test("recordSavedVersion points active+latest at the new CID with tagged manifest", () => {
  recordSavedVersion("bafyNew", { asset_id: "a1", version: 3 });
  const s = assetState.get();
  expect(s.latestAssetManifestCid).toBe("bafyNew");
  expect(s.activeAssetManifestCid).toBe("bafyNew");
  expect(s.currentManifest._manifestCid).toBe("bafyNew");
});

test("adoptPublishedIdentity stringifies tokenId and keeps assetId verbatim", () => {
  adoptPublishedIdentity(42, "asset_9");
  const s = assetState.get();
  expect(s.activeAssetTokenId).toBe("42");
  expect(s.activeCollectionTokenId).toBeNull();
  expect(s.activeAssetId).toBe("asset_9");
});
