/**
 * Collection helper unit tests.
 *
 * Tests the shared pure functions in frontend/src/js/utils/collections.js.
 */

import {
  mergeAssetIntoCollection,
  deriveDefaultAssetId,
} from "../../frontend/src/js/utils/collections.js";

describe("collections - mergeAssetIntoCollection", () => {
  it("creates a fresh collection manifest when none exists yet (default collection lazy-mint)", () => {
    const result = mergeAssetIntoCollection(null, "asset_1", "bafyAssetCid");
    expect(result.type).toBe("collection");
    expect(result.assets).toEqual({ asset_1: "bafyAssetCid" });
  });

  it("adds a new assetID entry without disturbing existing entries", () => {
    const existing = {
      type: "collection",
      version: 2,
      assets: { "chair-01": "bafyChairCid" },
    };
    const result = mergeAssetIntoCollection(existing, "room-01", "bafyRoomCid");
    expect(result.assets).toEqual({
      "chair-01": "bafyChairCid",
      "room-01": "bafyRoomCid",
    });
    expect(result.version).toBe(2); // version bump happens elsewhere, not in merge
  });

  it("overwrites an existing assetID's CID on re-besk", () => {
    const existing = {
      type: "collection",
      assets: { "chair-01": "bafyChairCidV1" },
    };
    const result = mergeAssetIntoCollection(
      existing,
      "chair-01",
      "bafyChairCidV2"
    );
    expect(result.assets["chair-01"]).toBe("bafyChairCidV2");
  });
});

describe("collections - deriveDefaultAssetId", () => {
  it("reuses an existing assetID when present", () => {
    expect(deriveDefaultAssetId("chair-01", "asset_123")).toBe("chair-01");
  });

  it("derives a fresh assetID from the fallback when none exists", () => {
    expect(deriveDefaultAssetId(null, "asset_123")).toBe("asset_123");
  });

  it("falls back to a generated id when neither argument is provided", () => {
    const result = deriveDefaultAssetId(null, null);
    expect(result).toMatch(/^asset_\d+$/);
  });
});
