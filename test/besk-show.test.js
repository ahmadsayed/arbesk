/**
 * besk show: builds the Studio deep link for an asset
 * (/studio?asset=<tokenId>&assetId=<id>, or ?manifest=<cid> for a pinned
 * version) and opens it in the system browser — or just returns the URL when
 * open is false (MCP agents, scripts, headless boxes).
 */
import { jest } from "@jest/globals";
import os from "os";
import path from "path";

process.env.ARBESK_CACHE_PATH = path.join(os.tmpdir(), "besk-show-test-cache-" + process.pid + ".json");

const spawnMock = jest.fn(() => ({ unref: jest.fn() }));
jest.unstable_mockModule("child_process", () => ({ spawn: spawnMock }));

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const manifests = {};

function resetManifests() {
  for (const k of Object.keys(manifests)) delete manifests[k];
  manifests.bafyCol1 = {
    type: "collection", name: null, asset_id: "c1", version: 1,
    assets: { asset_world: "bafyWorld" },
  };
  manifests.bafyWorld = {
    type: "asset", name: "world", asset_id: "asset_world", version: 2, timestamp: 2,
    prev_asset_manifest_cid: "bafyWorldV1",
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyWorldSrc" } }] },
  };
  manifests.bafyWorldV1 = {
    type: "asset", name: "world", asset_id: "asset_world", version: 1, timestamp: 1,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: IDENTITY, source: { cid: "bafyWorldSrc" } }] },
  };
  manifests.bafyWorldSrc = { asset: { version: "2.0" }, nodes: [] };
}

jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({ contractAddress: "0x0", ipfsGatewayUrl: "http://gw", networkConfigs: {} })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyCol1"),
    listTokens: jest.fn(async ({ scope }) => (scope === "owned" ? ["1"] : [])),
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
    writeJSON: jest.fn(async () => "bafyWritten"),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { showAsset } = await import("../packages/besk/src/show.ts");

beforeEach(() => {
  resetManifests();
  spawnMock.mockClear();
});

describe("besk show", () => {
  test("opens the collection-context deep link in the browser by default", async () => {
    const r = await showAsset({ tokenId: "1", assetID: "asset_world", cid: "bafyWorld" });
    expect(r.url).toBe("http://localhost:9090/studio?asset=1&assetId=asset_world");
    expect(r.opened).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, cmdArgs] = spawnMock.mock.calls[0];
    expect(typeof cmd).toBe("string");
    expect(cmdArgs).toEqual([r.url]);
  });

  test("open: false returns the URL without launching a browser", async () => {
    const r = await showAsset({ tokenId: "1", assetID: "asset_world", cid: "bafyWorld", open: false });
    expect(r.url).toContain("/studio?asset=1&assetId=asset_world");
    expect(r.opened).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("a pinned version uses the manifest deep link", async () => {
    const r = await showAsset({ tokenId: "1", assetID: "asset_world", cid: "bafyWorld", version: "1", open: false });
    expect(r.url).toBe("http://localhost:9090/studio?manifest=bafyWorldV1");
  });

  test("rejects an unknown version", async () => {
    await expect(
      showAsset({ tokenId: "1", assetID: "asset_world", cid: "bafyWorld", version: "99", open: false }),
    ).rejects.toThrow(/Version 99 not found/);
  });
});
