/**
 * @jest-environment jsdom
 *
 * Domain asset facade: snapshot immutability, subscribe/notify, and the
 * naming rules (rename, loaded-manifest adoption, new-asset reset, close).
 */
import { expect, test, beforeEach } from "@jest/globals";
import {
  getAssetSnapshot,
  subscribeAsset,
  renameAsset,
  adoptLoadedManifestName,
  adoptManifestName,
  isDefaultAssetName,
  resetForNewAsset,
  closeAsset,
} from "../../frontend/src/js/domain/asset.js";
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";

beforeEach(() => _resetForTesting());

test("snapshot is frozen and reflects the store", () => {
  assetState.set({ activeAssetName: "Chair", activeAssetTokenId: "7" });
  const snap = getAssetSnapshot();
  expect(snap.name).toBe("Chair");
  expect(snap.tokenId).toBe("7");
  expect(Object.isFrozen(snap)).toBe(true);
  expect(() => { snap.name = "x"; }).toThrow();
});

test("subscribeAsset fires immediately and on every store change", () => {
  const seen = [];
  const unsub = subscribeAsset((s) => seen.push(s.name));
  expect(seen).toEqual([null]);
  renameAsset("Table");
  expect(seen).toEqual([null, "Table"]);
  unsub();
  renameAsset("Lamp");
  expect(seen).toEqual([null, "Table"]);
});

test("adoptLoadedManifestName: manifest name wins, else keep, else Untitled", () => {
  assetState.set({ activeAssetName: "Session Name" });
  adoptLoadedManifestName({ name: "Manifest Name" });
  expect(assetState.get().activeAssetName).toBe("Manifest Name");

  _resetForTesting();
  adoptLoadedManifestName({ name: "Manifest Name" });
  expect(assetState.get().activeAssetName).toBe("Manifest Name");

  _resetForTesting();
  assetState.set({ activeAssetName: "Session Name" });
  adoptLoadedManifestName({}); // no manifest name → keep session name
  expect(assetState.get().activeAssetName).toBe("Session Name");

  _resetForTesting();
  adoptLoadedManifestName({}); // nothing anywhere → Untitled Asset
  expect(assetState.get().activeAssetName).toBe("Untitled Asset");
});

test("adoptManifestName never clobbers a good name with a default", () => {
  assetState.set({ activeAssetName: "My Chair" });
  adoptManifestName({ name: "Untitled Asset" });
  expect(assetState.get().activeAssetName).toBe("My Chair");
  adoptManifestName({ name: "Real Name" });
  expect(assetState.get().activeAssetName).toBe("Real Name");
  expect(isDefaultAssetName("  untitled asset ")).toBe(true);
  expect(isDefaultAssetName("My Chair")).toBe(false);
});

test("resetForNewAsset clears name and CIDs but preserves the collection", () => {
  assetState.set({
    activeAssetName: "Old",
    activeAssetManifestCid: "bafyOld",
    latestAssetManifestCid: "bafyOld",
    activeAssetTokenId: "42",
    activeAssetId: "a1",
    activeCollectionTokenId: "7",
  });
  resetForNewAsset();
  const s = assetState.get();
  expect(s.activeAssetName).toBeNull();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBeNull();
  expect(s.activeCollectionTokenId).toBe("7");
});

test("closeAsset clears all active-asset identity fields", () => {
  assetState.set({
    activeAssetName: "Old",
    activeAssetManifestCid: "bafyOld",
    latestAssetManifestCid: "bafyOld",
    activeAssetTokenId: "42",
    activeAssetId: "a1",
    currentManifest: { type: "asset" },
  });
  closeAsset();
  const s = assetState.get();
  expect(s.activeAssetName).toBeNull();
  expect(s.activeAssetManifestCid).toBeNull();
  expect(s.latestAssetManifestCid).toBeNull();
  expect(s.activeAssetTokenId).toBeNull();
  expect(s.activeAssetId).toBeNull();
  expect(s.currentManifest).toBeNull();
});
