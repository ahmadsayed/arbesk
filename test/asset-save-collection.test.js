/**
 * asset-save.js collection-merge logic — Unit Tests
 *
 * Inline copies of pure functions from frontend/src/js/ui/asset-save.js,
 * matching the established pattern in test/token-resolver.test.js and
 * test/scene-graph.test.js (avoids Jest ESM issues with browser globals).
 */

/** Inline copy of mergeAssetIntoCollection from frontend/src/js/ui/asset-save.js */
function mergeAssetIntoCollection(collectionManifest, assetID, assetCid) {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...(base.assets || {}) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/** Inline copy of deriveDefaultAssetId from frontend/src/js/ui/asset-save.js */
function deriveDefaultAssetId(existingAssetId, fallbackSeed) {
  if (existingAssetId) return existingAssetId;
  return `asset_${fallbackSeed}`;
}

describe("asset-save — mergeAssetIntoCollection", () => {
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

describe("asset-save — deriveDefaultAssetId", () => {
  it("reuses an existing assetID when present", () => {
    expect(deriveDefaultAssetId("chair-01", 123)).toBe("chair-01");
  });

  it("derives a fresh assetID from the seed when none exists", () => {
    expect(deriveDefaultAssetId(null, 123)).toBe("asset_123");
  });
});
