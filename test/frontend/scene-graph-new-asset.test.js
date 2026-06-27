/**
 * @jest-environment jsdom
 */
import { expect, test, describe } from "@jest/globals";
import { getStateForNewAsset } from "../../frontend/src/js/utils/new-asset.js";

describe("getStateForNewAsset", () => {
  test("clears the current asset but preserves the opened collection", () => {
    const next = getStateForNewAsset({
      activeAssetManifestCid: "bafyOld",
      latestAssetManifestCid: "bafyOld",
      activeAssetTokenId: "42",
      activeAssetId: "chair-01",
      activeCollectionTokenId: "7",
      selectedCollectionId: "7",
    });

    expect(next.activeAssetManifestCid).toBeNull();
    expect(next.latestAssetManifestCid).toBeNull();
    expect(next.activeAssetTokenId).toBeNull();
    expect(next.activeAssetId).toBeNull();
    expect(next.activeCollectionTokenId).toBe("7");
    expect(next.selectedCollectionId).toBe("7");
  });

  test("preserves selected collection even when it differs from active collection", () => {
    const next = getStateForNewAsset({
      activeCollectionTokenId: "7",
      selectedCollectionId: "9",
    });

    expect(next.activeCollectionTokenId).toBe("7");
    expect(next.selectedCollectionId).toBe("9");
  });

  test("handles missing state gracefully", () => {
    const next = getStateForNewAsset(null);
    expect(next.activeCollectionTokenId).toBeNull();
    expect(next.selectedCollectionId).toBeNull();
  });
});
