/**
 * besk link: appends a child node (fork = frozen source CID, live-ref =
 * child_ref tracking the source collection asset) to a parent asset's scene,
 * with an optional position/scale baked into the 16-element column-major
 * transform_matrix. Writes a new parent manifest version (prev-linked) and
 * points the collection entry at it.
 */
import { jest } from "@jest/globals";

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Mutable fixture store: tests can swap the parent manifest per case.
const manifests = {};
const written = [];

function resetManifests() {
  for (const k of Object.keys(manifests)) delete manifests[k];
  manifests.bafyParentCollection = {
    type: "collection", asset_id: "c1", version: 1, assets: { asset_p: "bafyParentEntry" },
  };
  manifests.bafyParentEntry = {
    type: "asset", name: "world", asset_id: "asset_p", version: 1, timestamp: 1,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyRoot" } }] },
  };
  manifests.bafySceneless = { asset: { version: "2.0" }, meshes: [], buffers: [] };
}

jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({
    contractAddress: "0x0",
    ipfsGatewayUrl: "http://gw",
    networkConfigs: { 84532: { contractAddress: "0xContract84532", rpcUrl: "http://rpc" } },
  })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyParentCollection"),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async (cid) => {
      if (!(cid in manifests)) throw new Error("unknown cid " + cid);
      return structuredClone(manifests[cid]);
    }),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(),
    writeJSON: jest.fn(async (json) => { written.push(json); return "bafyWritten" + written.length; }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { linkChildAsset } = await import("../packages/besk/src/link.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };
const BASE = {
  parentTokenId: "1", parentAssetId: "asset_p", parentCid: "bafyParentEntry",
  childTokenId: "2", childAssetId: "asset_c", childCid: "bafyChild",
};

beforeEach(() => {
  resetManifests();
  written.length = 0;
  relayMock.mockClear();
});

describe("besk linkChildAsset", () => {
  test("live-ref appends a child_ref node with an identity transform and bumps the parent version", async () => {
    const result = await linkChildAsset(SESSION, { ...BASE, mode: "live-ref" });

    expect(result.nodeId).toBe("linked_2_asset_c");
    expect(written).toHaveLength(2); // new parent manifest, then the collection
    const parent = written[0];
    expect(parent.version).toBe(2);
    expect(parent.prev_asset_manifest_cid).toBe("bafyParentEntry");
    expect(parent.scene.nodes).toHaveLength(2);
    const node = parent.scene.nodes[1];
    expect(node.child_ref).toEqual({
      collection: { chainId: 84532, contractAddress: "0xContract84532", tokenId: "2" },
      assetID: "asset_c",
    });
    expect(node.transform_matrix).toEqual(IDENTITY);
    expect(written[1].assets.asset_p).toBe("bafyWritten1");
    expect(relayMock).toHaveBeenCalledWith(SESSION, "updateUri", "1", { newUri: "bafyWritten2", proof: [], assetId: "asset_p" });
  });

  test("fork appends a node with a frozen source CID instead of child_ref", async () => {
    await linkChildAsset(SESSION, { ...BASE, mode: "fork" });
    const node = written[0].scene.nodes[1];
    expect(node.source).toEqual({ cid: "bafyChild" });
    expect(node.child_ref).toBeUndefined();
  });

  test("position and scale bake into the column-major transform matrix", async () => {
    await linkChildAsset(SESSION, {
      ...BASE, mode: "live-ref", position: { x: 1, y: 2, z: 3 }, scale: 2,
    });
    expect(written[0].scene.nodes[1].transform_matrix).toEqual(
      [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1],
    );
  });

  test("rejects a parent without an editable scene (raw composite upload)", async () => {
    await expect(
      linkChildAsset(SESSION, { ...BASE, parentCid: "bafySceneless", mode: "live-ref" }),
    ).rejects.toThrow(/no editable scene/);
    expect(relayMock).not.toHaveBeenCalled();
  });

  test("suffixes the node id when it collides with an existing node", async () => {
    manifests.bafyParentEntry.scene.nodes.push({
      node_id: "linked_2_asset_c", transform_matrix: IDENTITY,
    });

    const result = await linkChildAsset(SESSION, { ...BASE, mode: "live-ref" });

    expect(result.nodeId).not.toBe("linked_2_asset_c");
    expect(result.nodeId).toMatch(/^linked_2_asset_c_/);
  });
});
