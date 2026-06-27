/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const OWNER = "0xOwner";
const TOKEN_ID = "42";
const TARGET_TOKEN_ID = "43";
const VERSION = 1;
const EDITOR_PROOF = ["0xProof"];
const ASSET_CID = "QmAssetManifest";
const COLLECTION_CID = "QmCollection";
const NEW_COLLECTION_CID = "QmNewCollection";

let _walletAddress = OWNER;
let _activeAssetTokenId = null;
let _activeAssetId = null;
let _dialogResult = "delete";
let _collectionManifest = null;
let _targetCollectionManifest = null;
let _getProofResult = { proof: EDITOR_PROOF, role: 2 };
let _updateAssetURIResult = "0xUpdateTx";
let _burnResult = "0xBurnTx";
let _wroteCollection = null;
let _unpinResult = { count: 1, errors: [] };

beforeEach(() => {
  jest.resetModules();
  _walletAddress = OWNER;
  _activeAssetTokenId = null;
  _activeAssetId = null;
  _dialogResult = "delete";
  _getProofResult = { proof: EDITOR_PROOF, role: 2 };
  _updateAssetURIResult = "0xUpdateTx";
  _burnResult = "0xBurnTx";
  _unpinResult = { count: 1, errors: [] };

  _collectionManifest = {
    type: "collection",
    asset_id: "col_1",
    version: 1,
    assets: { asset_1: ASSET_CID },
  };
  _targetCollectionManifest = {
    type: "collection",
    asset_id: "col_2",
    version: 1,
    assets: {},
  };
  _wroteCollection = null;
});

function _mockContract() {
  return {
    methods: {
      tokenURI: (tokenId) => ({
        call: jest.fn().mockResolvedValue(
          String(tokenId) === String(TARGET_TOKEN_ID)
            ? "QmTargetCollection"
            : COLLECTION_CID
        ),
      }),
      editorSetVersion: (_tokenId) => ({
        call: jest.fn().mockResolvedValue(String(VERSION)),
      }),
    },
  };
}

function _getProof() {
  return _getProofResult;
}

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: _walletAddress,
          contract: _mockContract(),
        })),
        _resetForTesting: jest.fn(),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/asset-state.js",
    () => ({
      assetState: {
        get: jest.fn(() => ({
          activeAssetTokenId: _activeAssetTokenId,
          activeAssetId: _activeAssetId,
        })),
        _resetForTesting: jest.fn(),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet.js",
    () => ({
      contract: _mockContract(),
      updateAssetURI: jest.fn().mockResolvedValue(_updateAssetURIResult),
      CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
      burn: jest.fn().mockResolvedValue(_burnResult),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-guard.js",
    () => ({
      requireWallet: jest.fn().mockReturnValue({
        contract: _mockContract(),
        walletAddress: _walletAddress,
      }),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/gltf/merkle-editors.js",
    () => ({
      getProof: jest.fn((_list, _address, _tokenId, _version) => _getProof()),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn().mockImplementation((cid) => {
        if (cid === "QmTargetCollection") return Promise.resolve(_targetCollectionManifest);
        return Promise.resolve(_collectionManifest);
      }),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/write-to-ipfs.js",
    () => ({
      writeJSONToIPFS: jest
        .fn()
        .mockImplementation((json, _credential, options) => {
          _wroteCollection = { json, options };
          return Promise.resolve(NEW_COLLECTION_CID);
        }),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/services/api.js",
    () => ({
      unpinAssetCids: jest.fn().mockResolvedValue(_unpinResult),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ui/dialog.js",
    () => ({
      showConfirmDialog: jest.fn().mockResolvedValue(_dialogResult),
      showDialog: jest.fn().mockResolvedValue(null),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ui/toasts.js",
    () => ({
      showToast: jest.fn(),
      dismissToast: jest.fn(),
      dismissAllToasts: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/events/bus.js",
    () => ({
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      EVENTS: {
        ASSET_CLEARED: "asset:cleared",
        ASSET_BURNED: "asset:burned",
        WALLET_DISCONNECTED: "wallet:disconnected",
        ASSET_STATE_CHANGED: "asset:stateChanged",
      },
    })
  );

  const mod = await import("../../frontend/src/js/services/asset-delete.js");
  return mod;
}

describe("deleteAssetFromCollection", () => {
  test("cancel returns null", async () => {
    _dialogResult = "cancel";
    const { deleteAssetFromCollection } = await loadModule();
    const result = await deleteAssetFromCollection({
      tokenId: TOKEN_ID,
      assetId: "asset_1",
      assetName: "My Asset",
    });
    expect(result).toBeNull();
  });

  test("delete removes asset, writes new collection, calls updateAssetURI, emits ASSET_CLEARED if active, unpins old CID", async () => {
    _activeAssetTokenId = TOKEN_ID;
    _activeAssetId = "asset_1";
    const { deleteAssetFromCollection } = await loadModule();
    const { updateAssetURI } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    const { unpinAssetCids } = await import(
      "../../frontend/src/js/services/api.js"
    );
    const { emit, EVENTS } = await import("../../frontend/src/js/events/bus.js");

    const result = await deleteAssetFromCollection({
      tokenId: TOKEN_ID,
      assetId: "asset_1",
      assetName: "My Asset",
    });

    expect(result).toBe(NEW_COLLECTION_CID);
    expect(writeJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: {},
        prev_asset_manifest_cid: COLLECTION_CID,
        version: 2,
      }),
      null,
      expect.objectContaining({ type: "collection" })
    );
    expect(updateAssetURI).toHaveBeenCalledWith(
      TOKEN_ID,
      NEW_COLLECTION_CID,
      EDITOR_PROOF
    );
    expect(unpinAssetCids).toHaveBeenCalledWith(ASSET_CID, OWNER);
    expect(emit).toHaveBeenCalledWith(EVENTS.ASSET_CLEARED);
  });

  test("warning toast if asset already removed", async () => {
    const { deleteAssetFromCollection } = await loadModule();
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const result = await deleteAssetFromCollection({
      tokenId: TOKEN_ID,
      assetId: "missing_asset",
      assetName: "Missing Asset",
    });

    expect(result).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "warning", title: "Already removed" })
    );
  });

  test("throws when editor proof cannot be built", async () => {
    _getProofResult = null;
    const { deleteAssetFromCollection } = await loadModule();

    await expect(
      deleteAssetFromCollection({
        tokenId: TOKEN_ID,
        assetId: "asset_1",
        assetName: "My Asset",
      })
    ).rejects.toThrow("Not an authorized editor");
  });
});

describe("burnCollection", () => {
  test("builds proof and calls burn", async () => {
    const { burnCollection } = await loadModule();
    const { burn } = await import("../../frontend/src/js/blockchain/wallet.js");

    const result = await burnCollection(TOKEN_ID);

    expect(result).toBe(_burnResult);
    expect(burn).toHaveBeenCalledWith(TOKEN_ID, EDITOR_PROOF);
  });
});

describe("updateCollectionManifest", () => {
  test("mutates, writes, updates tokenURI", async () => {
    const { updateCollectionManifest } = await loadModule();
    const { updateAssetURI } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );

    const mutate = jest.fn((col) => {
      col.metadata = { updated: true };
      return col;
    });

    const result = await updateCollectionManifest(TOKEN_ID, mutate, {
      label: "test",
    });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ assets: _collectionManifest.assets })
    );
    expect(writeJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { updated: true }, version: 2 }),
      null,
      expect.objectContaining({ type: "collection" })
    );
    expect(updateAssetURI).toHaveBeenCalledWith(
      TOKEN_ID,
      NEW_COLLECTION_CID,
      EDITOR_PROOF
    );
    expect(result).toBe(NEW_COLLECTION_CID);
  });
});

describe("sendAssetToCollection", () => {
  test("move deletes from source and adds to target", async () => {
    const { sendAssetToCollection } = await loadModule();
    const { updateAssetURI } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );

    await sendAssetToCollection({
      sourceTokenId: TOKEN_ID,
      targetTokenId: TARGET_TOKEN_ID,
      assetId: "asset_1",
      assetName: "My Asset",
      mode: "move",
    });

    expect(updateAssetURI).toHaveBeenCalledTimes(2);
    const calls = updateAssetURI.mock.calls;
    expect(calls[0][0]).toBe(TOKEN_ID);
    expect(calls[1][0]).toBe(TARGET_TOKEN_ID);
  });

  test("copy leaves source intact", async () => {
    const { sendAssetToCollection } = await loadModule();
    const { updateAssetURI } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );

    await sendAssetToCollection({
      sourceTokenId: TOKEN_ID,
      targetTokenId: TARGET_TOKEN_ID,
      assetId: "asset_1",
      assetName: "My Asset",
      mode: "copy",
    });

    expect(updateAssetURI).toHaveBeenCalledTimes(1);
    expect(updateAssetURI.mock.calls[0][0]).toBe(TARGET_TOKEN_ID);
  });

  test("same source/target throws", async () => {
    const { sendAssetToCollection } = await loadModule();

    await expect(
      sendAssetToCollection({
        sourceTokenId: TOKEN_ID,
        targetTokenId: TOKEN_ID,
        assetId: "asset_1",
        assetName: "My Asset",
        mode: "move",
      })
    ).rejects.toThrow("Source and target collection must be different");
  });

  test("missing asset in source throws", async () => {
    const { sendAssetToCollection } = await loadModule();

    await expect(
      sendAssetToCollection({
        sourceTokenId: TOKEN_ID,
        targetTokenId: TARGET_TOKEN_ID,
        assetId: "missing_asset",
        assetName: "Missing Asset",
        mode: "move",
      })
    ).rejects.toThrow("Asset missing_asset not found in source collection");
  });
});
