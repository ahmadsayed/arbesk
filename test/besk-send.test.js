/**
 * besk send: links an asset into another collection — fork copies the current
 * asset CID under the same assetID; live-ref writes a wrapper asset manifest
 * with a child_ref back to the source collection so future edits propagate
 * (mirrors frontend/src/js/services/asset-delete.ts sendAssetToCollection).
 */
import { jest } from "@jest/globals";

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const written = [];
const TARGET_COLLECTION = {
  type: "collection", name: "target", asset_id: "collection_2",
  version: 1, timestamp: 1, assets: { existing: "cidX" },
};
const SOURCE_ASSET = {
  type: "asset", name: "robot", asset_id: "asset_1", version: 3,
  thumbnail: { type: "snapshot", cid: "bafyThumb" },
};
jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({
    contractAddress: "0xContract",
    ipfsGatewayUrl: "http://gw",
    networkConfigs: { 84532: { contractAddress: "0xContract84532", rpcUrl: "http://rpc" } },
  })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyTargetCollection"),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async (cid) => {
      if (cid === "bafyTargetCollection") return structuredClone(TARGET_COLLECTION);
      if (cid === "bafyAssetA") return structuredClone(SOURCE_ASSET);
      throw new Error("unknown cid " + cid);
    }),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(),
    writeJSON: jest.fn(async (json) => {
      written.push(json);
      return "bafyWritten" + written.length;
    }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { sendAssetToCollection } = await import("../packages/besk/src/send.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };

beforeEach(() => {
  written.length = 0;
  relayMock.mockClear();
});

describe("besk sendAssetToCollection", () => {
  test("fork copies the current asset CID into the target collection under the same assetID", async () => {
    const result = await sendAssetToCollection(SESSION, {
      sourceTokenId: "7", targetTokenId: "42",
      assetId: "asset_1", assetName: "robot", assetCid: "bafyAssetA",
      mode: "fork",
    });

    expect(result).toEqual({ targetAssetId: "asset_1", targetCid: "bafyAssetA" });
    // Only one IPFS write: the mutated target collection (no wrapper manifest).
    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("collection");
    expect(written[0].version).toBe(2);
    expect(written[0].prev_asset_manifest_cid).toBe("bafyTargetCollection");
    expect(written[0].assets).toEqual({ existing: "cidX", asset_1: "bafyAssetA" });
    expect(relayMock).toHaveBeenCalledWith(SESSION, "updateUri", "42", { newUri: "bafyWritten1", proof: [], assetId: "asset_1" });
  });

  test("live-ref writes a wrapper manifest with a child_ref back to the source asset", async () => {
    const result = await sendAssetToCollection(SESSION, {
      sourceTokenId: "7", targetTokenId: "42",
      assetId: "asset_1", assetName: "robot", assetCid: "bafyAssetA",
      mode: "live-ref",
    });

    expect(result.targetAssetId).toMatch(/^asset_\d+$/);
    expect(result.targetCid).toBe("bafyWritten1");
    // Two writes: wrapper asset manifest first, then the target collection.
    expect(written).toHaveLength(2);
    const wrapper = written[0];
    expect(wrapper.type).toBe("asset");
    expect(wrapper.name).toBe("robot");
    expect(wrapper.asset_id).toBe(result.targetAssetId);
    expect(wrapper.version).toBe(1);
    // Thumbnail carried over from the source asset manifest.
    expect(wrapper.thumbnail).toEqual({ type: "snapshot", cid: "bafyThumb" });
    const ref = wrapper.scene.nodes[0].child_ref;
    expect(ref.collection).toEqual({
      chainId: 84532,
      contractAddress: "0xContract84532",
      tokenId: "7",
    });
    expect(ref.assetID).toBe("asset_1");
    expect(wrapper.scene.nodes[0].transform_matrix).toHaveLength(16);
    expect(written[1].assets[result.targetAssetId]).toBe("bafyWritten1");
    expect(relayMock).toHaveBeenCalledWith(SESSION, "updateUri", "42", { newUri: "bafyWritten2", proof: [], assetId: expect.any(String) });
  });

  test("rejects sending a collection to itself", async () => {
    await expect(
      sendAssetToCollection(SESSION, {
        sourceTokenId: "42", targetTokenId: "42",
        assetId: "asset_1", assetName: "robot", assetCid: "bafyAssetA",
        mode: "fork",
      }),
    ).rejects.toThrow("Source and target collection must be different");
    expect(relayMock).not.toHaveBeenCalled();
  });

  test("rejects an unsupported mode", async () => {
    await expect(
      sendAssetToCollection(SESSION, {
        sourceTokenId: "7", targetTokenId: "42",
        assetId: "asset_1", assetName: "robot", assetCid: "bafyAssetA",
        mode: "move",
      }),
    ).rejects.toThrow("Unsupported link mode");
  });

  test("live-ref tolerates a source manifest without a thumbnail", async () => {
    const result = await sendAssetToCollection(SESSION, {
      sourceTokenId: "7", targetTokenId: "42",
      assetId: "asset_1", assetName: "robot", assetCid: "bafyNoThumb",
      mode: "live-ref",
    });
    // bafyNoThumb is unknown to the read port: thumbnail lookup is best-effort.
    expect(written[0].thumbnail).toBeNull();
    expect(result.targetCid).toBe("bafyWritten1");
  });
});
