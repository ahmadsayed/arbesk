/** @jest-environment jsdom */
import { jest } from "@jest/globals";

const getFromRemoteIPFS = jest.fn();
const getBlobFromRemoteIPFS = jest.fn();
const composeGlTFToBlobAsync = jest.fn();
let _assetState = { activeAssetManifestCid: null, activeAssetName: null };

let downloadAssetByManifestCid;
let downloadActiveAsset;

function manifestWithSource(source) {
  return {
    name: "Knight",
    scene: {
      nodes: [
        { node_id: "n1", type: "source_asset", source },
      ],
    },
  };
}

beforeAll(async () => {
  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    getFromRemoteIPFS,
    getBlobFromRemoteIPFS,
  }));
  jest.unstable_mockModule("../../frontend/src/js/asset-core/gltf/async-gltf.js", () => ({
    composeGlTFToBlobAsync,
  }));
  jest.unstable_mockModule("../../frontend/src/js/domain/asset.js", () => ({
    getAssetState: jest.fn(() => _assetState),
  }));
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    announceStatus: jest.fn(),
  }));
  global.URL.createObjectURL = jest.fn(() => "blob:mock");
  global.URL.revokeObjectURL = jest.fn();
  ({ downloadAssetByManifestCid, downloadActiveAsset } = await import(
    "../../frontend/src/js/services/asset-download.js"
  ));
});

beforeEach(() => {
  jest.clearAllMocks();
  _assetState = { activeAssetManifestCid: null, activeAssetName: null };
});

test("GLB manifests download raw bytes with a sanitized filename", async () => {
  getFromRemoteIPFS.mockResolvedValue(
    manifestWithSource({ cid: "bafyGlb", path: "asset.glb", format: "glb" })
  );
  const blob = new Blob(["glb"], { type: "model/gltf-binary" });
  getBlobFromRemoteIPFS.mockResolvedValue(blob);

  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const filename = await downloadAssetByManifestCid("bafyManifest", "My Knight!");

  expect(filename).toBe("My Knight_.glb");
  expect(getBlobFromRemoteIPFS).toHaveBeenCalledWith("bafyGlb");
  expect(composeGlTFToBlobAsync).not.toHaveBeenCalled();
  expect(clickSpy).toHaveBeenCalled();
  clickSpy.mockRestore();
});

test("glTF manifests are composed (buffers inlined) before download", async () => {
  getFromRemoteIPFS
    .mockResolvedValueOnce(
      manifestWithSource({ cid: "bafyComposite", path: "asset.gltf", format: "gltf" })
    )
    .mockResolvedValueOnce({ asset: { version: "2.0" }, buffers: [] });
  composeGlTFToBlobAsync.mockResolvedValue(
    new Blob(["{}"], { type: "application/json" })
  );
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const filename = await downloadAssetByManifestCid("bafyManifest", "suka");

  expect(filename).toBe("suka.gltf");
  expect(getFromRemoteIPFS).toHaveBeenCalledWith("bafyComposite");
  expect(composeGlTFToBlobAsync).toHaveBeenCalled();
  expect(getBlobFromRemoteIPFS).not.toHaveBeenCalled();
});

test("falls back to the manifest name and asset.glb path", async () => {
  getFromRemoteIPFS.mockResolvedValue(manifestWithSource({ cid: "bafyGlb" }));
  getBlobFromRemoteIPFS.mockResolvedValue(new Blob(["x"]));
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const filename = await downloadAssetByManifestCid("bafyManifest");
  expect(filename).toBe("Knight.glb");
});

test("throws when the manifest has no source node", async () => {
  getFromRemoteIPFS.mockResolvedValue({ scene: { nodes: [] } });
  await expect(downloadAssetByManifestCid("bafyManifest")).rejects.toThrow(
    "no downloadable source file"
  );
});

test("downloadActiveAsset uses the open asset; throws when none is open", async () => {
  await expect(downloadActiveAsset()).rejects.toThrow("No asset is open");

  _assetState = {
    activeAssetManifestCid: "bafyManifest",
    activeAssetName: "Knight",
  };
  getFromRemoteIPFS.mockResolvedValue(
    manifestWithSource({ cid: "bafyGlb", path: "asset.glb" })
  );
  getBlobFromRemoteIPFS.mockResolvedValue(new Blob(["x"]));
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  const filename = await downloadActiveAsset();
  expect(filename).toBe("Knight.glb");
});
