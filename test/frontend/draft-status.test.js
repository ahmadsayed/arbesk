import { beforeEach, expect, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { assetStore, _resetForTesting } from "@arbesk/asset-core/domain/asset-store.js";
import { hasUnsavedChanges } from "../../frontend/src/js/state/unsaved-changes.js";
import { hasUnpublishedDraft, hasUnsavedOrUnpublished } from "../../frontend/src/js/state/draft-status.js";

beforeEach(() => {
  _resetForTesting();
  state.pendingTransformEdits = new Map();
});

test("no latest manifest means no unpublished draft", () => {
  expect(hasUnpublishedDraft()).toBe(false);
});

test("never-published asset with a saved manifest is unpublished", () => {
  assetStore.set({ activeAssetManifestCid: "bafyA", latestAssetManifestCid: "bafyA" });
  expect(hasUnpublishedDraft()).toBe(true);
  expect(hasUnsavedChanges()).toBe(false);
  expect(hasUnsavedOrUnpublished()).toBe(true);
});

test("tokenized asset whose published CID is still unknown is not flagged", () => {
  assetStore.set({
    activeAssetManifestCid: "bafyA",
    latestAssetManifestCid: "bafyA",
    activeAssetTokenId: "7",
  });
  expect(hasUnpublishedDraft()).toBe(false);
});
