/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const OWNER = "0xOwner";
const OTHER = "0xOther";
const TOKEN_ID = "42";
const VERSION = 1;
const OWNER_LEAF = "0xOwnerLeaf";
const EDITOR_ROOT = "0xOwnerLeaf";
const EDITOR_PROOF = ["0xProof"];

let _editorList = [];
let _ownerOfResult = null; // null => revert/nonexistent
let _editorRootResult = EDITOR_ROOT;
let _updateAssetURIResult = "0xTx";
let _connectedWallet = OWNER;

beforeEach(() => {
  jest.resetModules();
  _editorList = [];
  _ownerOfResult = null;
  _editorRootResult = EDITOR_ROOT;
  _updateAssetURIResult = "0xTx";
  _connectedWallet = OWNER;
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: _connectedWallet,
          contract: _mockContract(),
        })),
      },
    })
  );

  const walletContract = _mockContract();
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet.js",
    () => ({
      contract: walletContract,
      web3: null,
      walletWeb3: null,
      NETWORKS: {},
      initWallet: jest.fn(),
      connectWallet: jest.fn(),
      disconnectWallet: jest.fn(),
      autoConnectWallet: jest.fn(),
      authenticateUser: jest.fn(),
      switchNetwork: jest.fn(),
      payForGenerationWithUSDC: jest.fn().mockResolvedValue("0xTx"),
      recordGeneration: jest.fn().mockResolvedValue("0xTx"),
      isFreeTierContract: jest.fn().mockReturnValue(true),
      publishAsset: jest.fn().mockResolvedValue("0xTx"),
      updateAssetURI: jest.fn().mockResolvedValue(_updateAssetURIResult),
      updateEditors: jest.fn().mockResolvedValue("0xTx"),
      CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
      burn: jest.fn().mockResolvedValue("0xTx"),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn().mockResolvedValue(_editorList),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/write-to-ipfs.js",
    () => ({
      writeToIPFS: jest.fn().mockResolvedValue("bafySource"),
      writeJSONToIPFS: jest.fn().mockResolvedValue("bafyJson"),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/gltf/merkle-editors.js",
    () => ({
      computeRoot: jest.fn((list, _tokenId, _version) => {
        if (!list || list.length === 0) return "0x" + "0".repeat(64);
        if (list.length === 1 && list[0].address.toLowerCase() === OWNER.toLowerCase()) {
          return EDITOR_ROOT;
        }
        return "0xOtherRoot";
      }),
      getProof: jest.fn((list, target, _tokenId, _version) => {
        const entry = list.find(
          (e) => e.address.toLowerCase() === target.toLowerCase()
        );
        if (!entry) return null;
        return { proof: EDITOR_PROOF, role: entry.role };
      }),
      makeLeaf: jest.fn((address, _role, _tokenId, _version) => {
        if (address.toLowerCase() === OWNER.toLowerCase()) return OWNER_LEAF;
        return "0x" + address.slice(2).padStart(64, "0");
      }),
      verifyProof: jest.fn().mockReturnValue(true),
    })
  );

  const mod = await import("../../frontend/src/js/services/asset-save/editor-publish.js");
  return mod;
}

function _mockContract() {
  return {
    methods: {
      ownerOf: (_tokenId) => ({
        call: jest.fn().mockImplementation(() => {
          if (_ownerOfResult) return Promise.resolve(_ownerOfResult);
          return Promise.reject(new Error("ERC721NonexistentToken"));
        }),
      }),
      editorSetVersion: (_tokenId) => ({
        call: jest.fn().mockResolvedValue(String(VERSION)),
      }),
      editorRoot: (_tokenId) => ({
        call: jest.fn().mockResolvedValue(_editorRootResult),
      }),
      editorListURI: (_tokenId) => ({
        call: jest.fn().mockResolvedValue("bafyEditorList"),
      }),
    },
  };
}

describe("verifyCanEdit", () => {
  test("succeeds when wallet is in the editor list", async () => {
    _editorList = [{ address: OWNER, role: 2 }];
    const { verifyCanEdit } = await loadModule();
    await expect(verifyCanEdit(TOKEN_ID, OWNER)).resolves.toBeUndefined();
  });

  test("succeeds for owner via single-editor fallback when editor list is empty", async () => {
    _editorList = [];
    _ownerOfResult = OWNER;
    const { verifyCanEdit } = await loadModule();
    await expect(verifyCanEdit(TOKEN_ID, OWNER)).resolves.toBeUndefined();
  });

  test("throws helpful message when owner is not in the editor tree", async () => {
    _editorList = [];
    _ownerOfResult = OWNER;
    _editorRootResult = "0xDifferentRoot";
    const { verifyCanEdit } = await loadModule();
    await expect(verifyCanEdit(TOKEN_ID, OWNER)).rejects.toThrow(
      "Token owner is not in the current editor list"
    );
  });

  test("throws generic message for non-owner without editor proof", async () => {
    _editorList = [{ address: OWNER, role: 2 }];
    _ownerOfResult = OWNER;
    _connectedWallet = OTHER;
    const { verifyCanEdit } = await loadModule();
    await expect(verifyCanEdit(TOKEN_ID, OTHER)).rejects.toThrow(
      "Not an authorized editor"
    );
  });
});

describe("republishCollection", () => {
  test("republishes when wallet is in the editor list", async () => {
    _editorList = [{ address: OWNER, role: 2 }];
    _ownerOfResult = OWNER;
    const { republishCollection } = await loadModule();
    const tx = await republishCollection(TOKEN_ID, "bafyCollection", OWNER);
    expect(tx).toBe("0xTx");
  });

  test("republishes for owner via single-editor fallback", async () => {
    _editorList = [];
    _ownerOfResult = OWNER;
    const { republishCollection } = await loadModule();
    const tx = await republishCollection(TOKEN_ID, "bafyCollection", OWNER);
    expect(tx).toBe("0xTx");
  });

  test("throws when owner fallback does not match the on-chain root", async () => {
    _editorList = [];
    _ownerOfResult = OWNER;
    _editorRootResult = "0xDifferentRoot";
    const { republishCollection } = await loadModule();
    await expect(
      republishCollection(TOKEN_ID, "bafyCollection", OWNER)
    ).rejects.toThrow("Token owner is not in the current editor list");
  });
});

describe("publishNewToken", () => {
  test("mints a new token with owner as the sole editor", async () => {
    _ownerOfResult = OWNER;
    const { publishNewToken } = await loadModule();
    const tx = await publishNewToken("bafyCollection", TOKEN_ID, OWNER);
    expect(tx).toBe("0xTx");
  });
});
