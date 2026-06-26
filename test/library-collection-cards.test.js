/** Inline copy of buildCollectionCardSummary from frontend/src/js/ui/asset-library.js */
function buildCollectionCardSummary(manifest, tokenId) {
  const assetCount = manifest?.assets
    ? Object.keys(manifest.assets).length
    : 0;
  return {
    tokenId: String(tokenId),
    name: manifest?.name || `Collection #${tokenId}`,
    assetCount,
    thumbnailCid: manifest?.thumbnail?.cid || null,
  };
}

describe("asset-library - buildCollectionCardSummary", () => {
  it("counts assets in the collection's assets map", () => {
    const manifest = {
      type: "collection",
      assets: { "chair-01": "bafy1", "room-01": "bafy2" },
    };
    expect(buildCollectionCardSummary(manifest, "42")).toEqual({
      tokenId: "42",
      name: "Collection #42",
      assetCount: 2,
      thumbnailCid: null,
    });
  });

  it("uses the manifest name and thumbnail when present", () => {
    const manifest = {
      type: "collection",
      name: "My Garden",
      assets: { "tree-01": "bafy1" },
      thumbnail: { cid: "bafyThumb" },
    };
    expect(buildCollectionCardSummary(manifest, "7")).toEqual({
      tokenId: "7",
      name: "My Garden",
      assetCount: 1,
      thumbnailCid: "bafyThumb",
    });
  });

  it("handles a missing assets map as zero assets", () => {
    expect(buildCollectionCardSummary({}, "1").assetCount).toBe(0);
  });
});
