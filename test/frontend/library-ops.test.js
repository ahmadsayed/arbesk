/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

// Mutable mock state so tests can override behavior without re-importing ESM modules.
let _publishAsset = jest.fn().mockResolvedValue("0xTx");
let _writeToIPFS = jest.fn().mockResolvedValue("bafySource");
let _writeJSONToIPFS = jest.fn().mockResolvedValue("bafyJson");
let _getFromRemoteIPFS = jest.fn();
let _updateCollectionManifest = jest.fn().mockResolvedValue("bafyCollection");
let _computeRoot = jest.fn().mockReturnValue("0xRoot");
let _getProof = jest.fn().mockReturnValue({ proof: ["0xProof"], role: 2 });

let _walletAddress = "0xUser";
let _contract = {
  methods: {
    ownerOf: () => ({ call: jest.fn().mockRejectedValue(new Error("ERC721NonexistentToken")) }),
    tokenURI: () => ({ call: jest.fn() }),
    editorSetVersion: () => ({ call: jest.fn().mockResolvedValue("1") }),
  },
};

beforeEach(() => {
  // jsdom does not implement Blob.arrayBuffer, but the upload helper uses it.
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(this);
      });
    };
  }

  window.Web3 = {
    utils: {
      soliditySha3: jest.fn((...args) => {
        const payload = JSON.stringify(args);
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
          hash = (hash << 5) - hash + payload.charCodeAt(i);
          hash |= 0;
        }
        return "0x" + Math.abs(hash).toString(16).padStart(64, "0");
      }),
    },
  };

  _publishAsset = jest.fn().mockResolvedValue("0xTx");
  _writeToIPFS = jest.fn().mockResolvedValue("bafySource");
  _writeJSONToIPFS = jest.fn().mockResolvedValue("bafyJson");
  _getFromRemoteIPFS = jest.fn();
  _updateCollectionManifest = jest.fn().mockResolvedValue("bafyCollection");
  _computeRoot = jest.fn().mockReturnValue("0xRoot");
  _getProof = jest.fn().mockReturnValue({ proof: ["0xProof"], role: 2 });
  _walletAddress = "0xUser";
  _contract = {
    methods: {
      ownerOf: () => ({ call: jest.fn().mockRejectedValue(new Error("ERC721NonexistentToken")) }),
      tokenURI: () => ({ call: jest.fn() }),
      editorSetVersion: () => ({ call: jest.fn().mockResolvedValue("1") }),
    },
  };
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: _walletAddress,
          contract: _contract,
        })),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/write-to-ipfs.js",
    () => ({
      writeToIPFS: jest.fn((...args) => _writeToIPFS(...args)),
      writeJSONToIPFS: jest.fn((...args) => _writeJSONToIPFS(...args)),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn((...args) => _getFromRemoteIPFS(...args)),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet.js",
    () => ({
      publishAsset: jest.fn((...args) => _publishAsset(...args)),
      updateAssetURI: jest.fn().mockResolvedValue("0xTx"),
      CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/gltf/merkle-editors.js",
    () => ({
      computeRoot: jest.fn((...args) => _computeRoot(...args)),
      getProof: jest.fn((...args) => _getProof(...args)),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/services/asset-delete.js",
    () => ({
      updateCollectionManifest: jest.fn((...args) => _updateCollectionManifest(...args)),
    })
  );

  const mod = await import("../../frontend/src/js/services/library-ops.js");
  return mod;
}

describe("createNamedCollection", () => {
  test("creates and mints a new collection", async () => {
    const { createNamedCollection } = await loadModule();
    const result = await createNamedCollection("Characters");

    expect(result.isNew).toBe(true);
    expect(result.tokenId).toBeTruthy();
    expect(_publishAsset).toHaveBeenCalled();
  });

  test("returns existing collection instead of re-minting", async () => {
    const ownerOfCall = jest.fn().mockResolvedValue("0xUser");
    const tokenURICall = jest.fn().mockResolvedValue("bafyExisting");
    _contract = {
      methods: {
        ownerOf: () => ({ call: ownerOfCall }),
        tokenURI: () => ({ call: tokenURICall }),
      },
    };

    const { createNamedCollection } = await loadModule();
    const result = await createNamedCollection("Characters");

    expect(result.isNew).toBe(false);
    expect(result.manifestCid).toBe("bafyExisting");
    expect(_publishAsset).not.toHaveBeenCalled();
  });

  test("throws when name is empty", async () => {
    const { createNamedCollection } = await loadModule();
    await expect(createNamedCollection("   ")).rejects.toThrow("Collection name is required");
  });

  test("throws when wallet is not connected", async () => {
    _walletAddress = null;
    _contract = null;
    const { createNamedCollection } = await loadModule();
    await expect(createNamedCollection("Characters")).rejects.toThrow("Not signed in");
  });
});

describe("uploadFileToCollection", () => {
  test("uploads a GLB file into the current collection", async () => {
    _writeJSONToIPFS = jest.fn().mockResolvedValue("bafyAssetManifest");
    const { uploadFileToCollection } = await loadModule();

    const file = new File(["binary"], "model.glb", { type: "model/gltf-binary" });
    const result = await uploadFileToCollection(file, "999");

    expect(_writeToIPFS).toHaveBeenCalledWith(expect.any(Uint8Array), "model.glb");
    expect(_writeJSONToIPFS).toHaveBeenCalled();
    expect(_updateCollectionManifest).toHaveBeenCalledWith("999", expect.any(Function), { label: "upload asset" });
    expect(result.assetManifestCid).toBe("bafyAssetManifest");
  });

  test("rejects unsupported extensions", async () => {
    const { uploadFileToCollection } = await loadModule();
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    await expect(uploadFileToCollection(file, "999")).rejects.toThrow("Unsupported file type");
  });

  test("rejects files over the size cap", async () => {
    const { uploadFileToCollection } = await loadModule();
    const file = new File([new ArrayBuffer(51 * 1024 * 1024)], "huge.glb", { type: "model/gltf-binary" });
    await expect(uploadFileToCollection(file, "999")).rejects.toThrow("too large");
  });

  test("requires an open collection", async () => {
    const { uploadFileToCollection } = await loadModule();
    const file = new File(["binary"], "model.glb", { type: "model/gltf-binary" });
    await expect(uploadFileToCollection(file, null)).rejects.toThrow("Open a collection first");
  });
});
