/**
 * besk updateCollection: every CLI collection write (upload/delete/rename)
 * goes through applyCollectionMutation — version bumps and prev links, or the
 * on-chain collection history chain silently breaks.
 */
import { jest } from "@jest/globals";

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const written = [];
jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({ contractAddress: "0x0", ipfsGatewayUrl: "http://gw", networkConfigs: {} })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyCurrentCollection"),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async () => ({
      type: "collection", name: "c", asset_id: "collection_1",
      version: 2, timestamp: 1, assets: { a: "cidA", b: "cidB" },
      prev_asset_manifest_cid: "bafyOlder",
    })),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(),
    writeJSON: jest.fn(async (json) => { written.push(json); return "bafyNewCollection"; }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { updateCollection } = await import("../packages/besk/src/catalog.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };

describe("besk updateCollection", () => {
  test("bumps version, links prev cid, relays updateUri, returns the new cid", async () => {
    const newCid = await updateCollection(SESSION, "42", (draft) => {
      delete draft.assets.b;
    });

    expect(newCid).toBe("bafyNewCollection");
    expect(written).toHaveLength(1);
    expect(written[0].version).toBe(3);
    expect(written[0].prev_asset_manifest_cid).toBe("bafyCurrentCollection");
    expect(written[0].assets).toEqual({ a: "cidA" });
    expect(relayMock).toHaveBeenCalledWith(SESSION, "updateUri", "42", { newUri: "bafyNewCollection", proof: [] });
  });
});
