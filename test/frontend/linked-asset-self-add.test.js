// @test-env dom
/**
 * Dropping the currently open asset into its own scene ("self-add") must not
 * create a live reference: a published child_ref pointing back at the same
 * collection token + assetID is a guaranteed cycle. The drop handler offers
 * fork-only in that case and refuses a live-ref choice outright.
 */

import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
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

  await mock.module(
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

  await mock.module(
    "@arbesk/asset-core/formats/gltf/async-gltf.js",
    () => ({
      composeAsync: jest.fn().mockResolvedValue(new TextEncoder().encode("gltf")),
      decomposeAsync: jest.fn(),
      editSourceColorsAsync: jest.fn(),
      isComposite: jest.fn(),
    })
  );

  await mock.module(
    "../../frontend/src/js/blockchain/token-resolver.js",
    () => ({
      resolveChildRef: jest.fn().mockResolvedValue(_resolveResult),
      resolveCollectionChildRef: jest.fn().mockResolvedValue(_resolveResult),
      clearResolutionCache: jest.fn(),
    })
  );

  await mock.module("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    on: jest.fn(),
    EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  }));

  await mock.module(
    "@arbesk/asset-core/domain/asset-store.js",
    () => ({
      assetStore: {
        get: jest.fn(() => ({})),
        set: jest.fn(),
      },
      tagManifestCid: jest.fn(),
    })
  );

  await mock.module(
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

  await mock.module(
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

  await mock.module(
    "../../frontend/src/js/engine/placeholders.js",
    () => ({
      createPlaceholder: jest.fn(() => ({ dispose: jest.fn() })),
      disposePlaceholder: jest.fn(),
    })
  );

  await mock.module(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ applyColor: jest.fn(), applyScale: jest.fn() })
  );

  await mock.module(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({
      disposeNode: jest.fn(),
      disposeNodeContent: jest.fn(),
      disposeNodeSubtree: jest.fn(),
      clearScene: jest.fn(),
    })
  );

  await mock.module(
    "../../frontend/src/js/engine/anchor-node.js",
    () => ({
      createAnchorNode: jest.fn(() => ({ parent: null, metadata: {} })),
    })
  );

  await mock.module("../../frontend/src/js/ui/dialog.js", () => ({
    showForkOrLiveRefDialog: jest.fn((assetID, options) => {
      _dialogCalls.push({ assetID, options });
      return Promise.resolve(_dialogChoice);
    }),
  }));

  const sceneLoader = await import("../../frontend/src/js/engine/scene-loader.js");
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
  resetModules();
  _dialogChoice = "fork";
  _resolveResult = { resolved: true, manifestCid: RESOLVED_CID };

  global.BABYLON = {
    SceneLoader: {
      ImportMeshAsync: jest
        .fn()
        .mockResolvedValue({ meshes: [], transformNodes: [] }),
    },
    MeshBuilder: {
      CreateBox: jest.fn(() => ({ parent: null, metadata: {}, isDisposed: () => false, dispose: jest.fn() })),
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

describe("insert mode", () => {
  async function emitted(name) {
    const bus = await import("@arbesk/asset-core/events/bus.js");
    return bus.emit.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
  }

  test("mode live-ref skips the dialog and emits ASSET_LINKED_INSERTED", async () => {
    const { sceneLoader, state } = await loadModule();
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" }));
    expect(_dialogCalls).toHaveLength(0);
    expect(state.pendingChildRefs).toHaveLength(1);
    expect(await emitted("ASSET_LINKED_INSERTED")).toEqual([
      { nodeId: state.pendingChildRefs[0].node_id, assetID: ASSET_ID, mode: "live-ref" },
    ]);
  });

  test("mode fork skips the dialog and inserts a copy", async () => {
    const { sceneLoader, state } = await loadModule();
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "fork" }));
    expect(_dialogCalls).toHaveLength(0);
    expect(state.pendingChildRefs).toHaveLength(1);
    expect(state.pendingChildRefs[0].child_ref).toBeUndefined();
    expect(await emitted("ASSET_LINKED_INSERTED")).toEqual([
      { nodeId: state.pendingChildRefs[0].node_id, assetID: ASSET_ID, mode: "fork" },
    ]);
  });

  test("no mode still asks", async () => {
    const { sceneLoader } = await loadModule();
    await sceneLoader.handleLinkedAssetDropped(makeDrop());
    expect(_dialogCalls).toHaveLength(1);
  });

  test("live-ref self-add with mode is downgraded to fork, not refused", async () => {
    const { sceneLoader, state } = await loadModule();
    setActiveAsset(state);
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" }));
    expect(_dialogCalls).toHaveLength(0);
    expect(state.pendingChildRefs).toHaveLength(1);
    expect(state.pendingChildRefs[0].child_ref).toBeUndefined();
    const events = await emitted("ASSET_LINKED_INSERTED");
    expect(events).toHaveLength(1);
    expect(events[0].mode).toBe("fork");
  });

  test("two rapid inserts get distinct node ids and two events", async () => {
    const { sceneLoader, state } = await loadModule();
    await Promise.all([
      sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" })),
      sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" })),
    ]);
    const ids = state.pendingChildRefs.map((n) => n.node_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const events = await emitted("ASSET_LINKED_INSERTED");
    expect(events.map((e) => e.nodeId).sort()).toEqual([...ids].sort());
  });

  test("unresolvable asset emits ASSET_LINKED_INSERT_FAILED and adds nothing", async () => {
    _resolveResult = { resolved: false, error: "nope" };
    const { sceneLoader, state } = await loadModule();
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" }));
    expect(state.pendingChildRefs).toHaveLength(0);
    expect(await emitted("ASSET_LINKED_INSERTED")).toHaveLength(0);
    expect(await emitted("ASSET_LINKED_INSERT_FAILED")).toHaveLength(1);
  });

  test("a live-ref load failure (cycle) rolls back and emits FAILED, not INSERTED", async () => {
    const { sceneLoader, state } = await loadModule();
    // Resolve OK for the drop, then fail the child resolution.
    const resolver = await import("../../frontend/src/js/blockchain/token-resolver.js");
    resolver.resolveCollectionChildRef
      .mockResolvedValueOnce({ resolved: true, manifestCid: RESOLVED_CID })
      .mockResolvedValueOnce({ resolved: false, error: "boom" });

    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" }));

    expect(state.pendingChildRefs).toHaveLength(0);
    expect(await emitted("ASSET_LINKED_INSERTED")).toHaveLength(0);
    const failed = await emitted("ASSET_LINKED_INSERT_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0].assetID).toBe(ASSET_ID);
    expect(typeof failed[0].reason).toBe("string");
  });

  test("a failed fork load (placeholder box) rolls back and emits FAILED", async () => {
    const { sceneLoader, state } = await loadModule();
    global.BABYLON.SceneLoader.ImportMeshAsync.mockRejectedValue(new Error("load blew up"));
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "fork" }));

    expect(state.pendingChildRefs).toHaveLength(0);
    expect(await emitted("ASSET_LINKED_INSERTED")).toHaveLength(0);
    const failed = await emitted("ASSET_LINKED_INSERT_FAILED");
    expect(failed).toHaveLength(1);
    expect(typeof failed[0].reason).toBe("string");
  });

  test("a thrown error rolls back the pending entry and emits FAILED", async () => {
    const { sceneLoader, state } = await loadModule();
    const ph = await import("../../frontend/src/js/engine/placeholders.js");
    ph.createPlaceholder.mockImplementationOnce(() => {
      throw new Error("placeholder blew up");
    });
    await sceneLoader.handleLinkedAssetDropped(makeDrop({ mode: "live-ref" }));

    expect(state.pendingChildRefs).toHaveLength(0);
    expect(await emitted("ASSET_LINKED_INSERTED")).toHaveLength(0);
    const failed = await emitted("ASSET_LINKED_INSERT_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("placeholder blew up");
  });
});
