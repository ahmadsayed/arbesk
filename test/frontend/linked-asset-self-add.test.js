/**
 * @jest-environment jsdom
 *
 * Dropping the currently open asset into its own scene ("self-add") must not
 * create a live reference: a published child_ref pointing back at the same
 * collection token + assetID is a guaranteed cycle. The drop handler offers
 * fork-only in that case and refuses a live-ref choice outright.
 */
import { jest } from "@jest/globals";

const CHAIN_ID = 31337;
const CONTRACT = "0xCollectionContract";
const TOKEN_ID = "42";
const ASSET_ID = "asset_1";
const RESOLVED_CID = "bafyResolvedAsset";

let _dialogChoice = "fork";
let _dialogCalls = [];
let _resolveResult = { resolved: true, manifestCid: RESOLVED_CID };

async function loadModule() {
  _dialogCalls = [];

  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
      getFromRemoteIPFS: jest.fn().mockResolvedValue({
        type: "asset",
        scene: { nodes: [] },
      }),
      getBase64FromRemoteIPFS: jest.fn(),
      getBlobFromRemoteIPFS: jest.fn(),
      getArrayBufferFromRemoteIPFS: jest.fn(),
      getRawArrayBufferFromRemoteIPFS: jest.fn(),
      getManifestChain: jest.fn(),
      isIpfsCidReachable: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/gltf/async-gltf.js",
    () => ({
      composeGlTFAsync: jest.fn(),
      composeGlTFToBlobAsync: jest
        .fn()
        .mockResolvedValue(new Blob(["gltf"])),
      decomposeGlTFAsync: jest.fn(),
      decomposeAndStoreAsync: jest.fn(),
      decomposeGLBAsync: jest.fn(),
      editSourceColorsAsync: jest.fn(),
      isComposite: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/token-resolver.js",
    () => ({
      resolveChildRef: jest.fn().mockResolvedValue(_resolveResult),
      resolveCollectionChildRef: jest.fn().mockResolvedValue(_resolveResult),
      clearResolutionCache: jest.fn(),
    })
  );

  await jest.unstable_mockModule("../../frontend/src/js/events/bus.js", () => ({
    emit: jest.fn(),
    on: jest.fn(),
    EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  }));

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/asset-state.js",
    () => ({
      assetState: {
        get: jest.fn(() => ({})),
        set: jest.fn(),
      },
      tagManifestCid: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          chainId: CHAIN_ID,
          contractAddress: CONTRACT,
        })),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/transforms.js",
    () => ({
      extractCid: (src) => (src && src.cid ? src.cid : src),
      detectAssetFormat: () => "gltf",
      getManifestNodes: (manifest) => manifest?.scene?.nodes || [],
      applyTransformMatrix: jest.fn(),
      applyDefaultMaterial: jest.fn(),
      centerImportedAsset: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/placeholders.js",
    () => ({
      createPlaceholder: jest.fn(() => ({ dispose: jest.fn() })),
      disposePlaceholder: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ applyColor: jest.fn(), applyScale: jest.fn() })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({ disposeNode: jest.fn(), clearScene: jest.fn() })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-graph.js",
    () => ({
      createAnchorNode: jest.fn(() => ({ parent: null, metadata: {} })),
    })
  );

  await jest.unstable_mockModule("../../frontend/src/js/ui/dialog.js", () => ({
    showForkOrLiveRefDialog: jest.fn((assetID, options) => {
      _dialogCalls.push({ assetID, options });
      return Promise.resolve(_dialogChoice);
    }),
  }));

  const sceneLoader = await import(
    "../../frontend/src/js/engine/scene-loader.js"
  );
  const { state } = await import("../../frontend/src/js/engine/state.js");
  return { sceneLoader, state };
}

function setActiveAsset(state) {
  state.activeCollectionRef = {
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    tokenId: TOKEN_ID,
  };
  state.activeCollectionCurrentAssetID = ASSET_ID;
}

function makeDrop(overrides = {}) {
  return {
    type: "linked_asset",
    token_id: TOKEN_ID,
    assetID: ASSET_ID,
    standard: "ERC721",
    resolution: "latest",
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetModules();
  _dialogChoice = "fork";
  _resolveResult = { resolved: true, manifestCid: RESOLVED_CID };

  global.BABYLON = {
    SceneLoader: {
      ImportMeshAsync: jest
        .fn()
        .mockResolvedValue({ meshes: [], transformNodes: [] }),
    },
    MeshBuilder: {
      CreateBox: jest.fn(() => ({ parent: null, metadata: {} })),
    },
  };
  global.URL.createObjectURL = jest.fn(() => "blob:mock");
  global.URL.revokeObjectURL = jest.fn();
});

afterEach(async () => {
  const { state } = await import("../../frontend/src/js/engine/state.js");
  state.pendingChildRefs = [];
  state.nodeAnchors = new Map();
  state.nodeMeshes = new Map();
  state.activeCollectionRef = null;
  state.activeCollectionCurrentAssetID = null;
});

describe("handleLinkedAssetDropped - self-add guard", () => {
  test("dropping the active asset offers fork-only (allowLiveRef: false)", async () => {
    const { sceneLoader, state } = await loadModule();
    setActiveAsset(state);
    _dialogChoice = "fork";

    await sceneLoader.handleLinkedAssetDropped(makeDrop());

    expect(_dialogCalls).toHaveLength(1);
    expect(_dialogCalls[0].options).toEqual(
      expect.objectContaining({ allowLiveRef: false })
    );
    // Fork still works: node frozen to the resolved CID, no child_ref.
    expect(state.pendingChildRefs).toHaveLength(1);
    expect(state.pendingChildRefs[0].source).toEqual({ cid: RESOLVED_CID });
    expect(state.pendingChildRefs[0].child_ref).toBeUndefined();
  });

  test("a live-ref choice on a self-drop is refused (no node created)", async () => {
    const { sceneLoader, state } = await loadModule();
    setActiveAsset(state);
    _dialogChoice = "live-ref";

    await sceneLoader.handleLinkedAssetDropped(makeDrop());

    expect(
      state.pendingChildRefs.filter((n) => n.child_ref)
    ).toHaveLength(0);
  });

  test("tokenId comparison is numeric-safe (hex vs decimal)", async () => {
    const { sceneLoader } = await loadModule();
    const { state } = await import("../../frontend/src/js/engine/state.js");
    setActiveAsset(state);
    state.activeCollectionRef.tokenId = "0x2a"; // 42 in hex

    await sceneLoader.handleLinkedAssetDropped(makeDrop({ token_id: "42" }));

    expect(_dialogCalls[0].options).toEqual(
      expect.objectContaining({ allowLiveRef: false })
    );
  });

  test("dropping a different asset from the same collection still allows live-ref", async () => {
    const { sceneLoader, state } = await loadModule();
    setActiveAsset(state);
    _dialogChoice = "live-ref";

    await sceneLoader.handleLinkedAssetDropped(
      makeDrop({ assetID: "asset_2" })
    );

    expect(_dialogCalls).toHaveLength(1);
    expect(_dialogCalls[0].options?.allowLiveRef).not.toBe(false);
    const liveRefNodes = state.pendingChildRefs.filter((n) => n.child_ref);
    expect(liveRefNodes).toHaveLength(1);
    expect(liveRefNodes[0].child_ref.assetID).toBe("asset_2");
  });

  test("dropping the same assetID from a different collection token still allows live-ref", async () => {
    const { sceneLoader, state } = await loadModule();
    setActiveAsset(state);
    _dialogChoice = "live-ref";

    await sceneLoader.handleLinkedAssetDropped(makeDrop({ token_id: "43" }));

    const liveRefNodes = state.pendingChildRefs.filter((n) => n.child_ref);
    expect(liveRefNodes).toHaveLength(1);
  });
});
