/**
 * @jest-environment jsdom
 *
 * Nesting dive/ascend: the asset name must be written through the domain
 * facade (renameAsset), and CID/tokenId identity through adoptOpenedAsset.
 */
import { jest, expect, test, beforeEach } from "@jest/globals";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import {
  assetStore,
  _resetForTesting as resetAssetState,
} from "@arbesk/asset-core/domain/asset-store.js";

const renameAssetSpy = jest.fn((name) =>
  assetStore.set({ activeAssetName: name })
);
// Behavior-preserving stand-in for the real command,
// mirroring renameAssetSpy above — the assertions below read assetStore.
const adoptOpenedAssetSpy = jest.fn((cid, identity = {}) => {
  const patch = {
    activeAssetManifestCid: cid,
    latestAssetManifestCid: cid,
  };
  if ("tokenId" in identity) patch.activeAssetTokenId = identity.tokenId;
  if ("assetId" in identity) patch.activeAssetId = identity.assetId;
  assetStore.set(patch);
});
const loadAssetManifestMock = jest.fn().mockResolvedValue(undefined);
const clearSceneMock = jest.fn();

let _childManifestCid = "bafyChild";
let _childManifest = { name: "Child Hub" };

let _mod = null;

async function loadModule() {
  await jest.unstable_mockModule(
    "@arbesk/asset-core/domain/asset.js",
    () => ({
      renameAsset: renameAssetSpy,
      adoptOpenedAsset: adoptOpenedAssetSpy,
      getAssetState: () => assetStore.get(),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-graph.js",
    () => ({
      clearScene: clearSceneMock,
      loadAssetManifest: loadAssetManifestMock,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn((cid) =>
        cid === _childManifestCid
          ? Promise.resolve(_childManifest)
          : Promise.reject(new Error(`Unknown CID ${cid}`))
      ),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/token-resolver.js",
    () => ({
      resolveChildRef: jest.fn(() =>
        Promise.resolve({ manifestCid: _childManifestCid })
      ),
      resolveCollectionChildRef: jest.fn(() =>
        Promise.resolve({ manifestCid: _childManifestCid })
      ),
    })
  );
  if (!_mod) {
    _mod = await import("../../frontend/src/js/ui/nesting.js");
    _mod.initNesting();
  }
  return _mod;
}

async function waitFor(cond) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

beforeEach(() => {
  resetAssetState();
  renameAssetSpy.mockClear();
  adoptOpenedAssetSpy.mockClear();
  loadAssetManifestMock.mockClear();
  clearSceneMock.mockClear();
  _childManifestCid = "bafyChild";
  _childManifest = { name: "Child Hub" };
  // Reset the module-level nav stack between tests.
  emit(EVENTS.SCENE_EMPTY);
  document.body.innerHTML = `
    <button id="backBtn" class="hidden"></button>
    <div id="pathBar"></div>
    <button id="publishAssetBtn"></button>
    <div id="bottomBarStatus"></div>
  `;
});

test("dive routes the child name through renameAsset and keeps CID/tokenId writes", async () => {
  const { ascendOneLevel } = await loadModule();

  assetStore.set({
    activeAssetManifestCid: "bafyParent",
    activeAssetName: "Parent World",
    activeAssetTokenId: "9",
  });

  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: { type: "token", tokenId: "5" },
  });
  await waitFor(() => loadAssetManifestMock.mock.calls.length > 0);

  expect(renameAssetSpy).toHaveBeenCalledTimes(1);
  expect(renameAssetSpy).toHaveBeenCalledWith("Child Hub");
  const s = assetStore.get();
  expect(s.activeAssetManifestCid).toBe("bafyChild");
  expect(s.latestAssetManifestCid).toBe("bafyChild");
  expect(s.activeAssetTokenId).toBe("5");
  expect(s.activeAssetName).toBe("Child Hub");

  // Ascend restores the parent's preserved name through the facade too.
  await ascendOneLevel();
  expect(renameAssetSpy).toHaveBeenCalledTimes(2);
  expect(renameAssetSpy).toHaveBeenLastCalledWith("Parent World");
  const p = assetStore.get();
  expect(p.activeAssetManifestCid).toBe("bafyParent");
  expect(p.latestAssetManifestCid).toBe("bafyParent");
  expect(p.activeAssetTokenId).toBe("9");
  expect(p.activeAssetName).toBe("Parent World");
});

test("dive falls back to 'Child Asset' when the child manifest has no name", async () => {
  await loadModule();
  _childManifest = {}; // no name

  assetStore.set({
    activeAssetManifestCid: "bafyParent",
    activeAssetName: "Parent World",
    activeAssetTokenId: "9",
  });

  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: { type: "token", tokenId: "5" },
  });
  await waitFor(() => loadAssetManifestMock.mock.calls.length > 0);

  expect(renameAssetSpy).toHaveBeenCalledWith("Child Asset");
  expect(assetStore.get().activeAssetName).toBe("Child Asset");
});

test("dive adopts the child's collection as the publish context, ascend restores it", async () => {
  const { ascendOneLevel } = await loadModule();

  assetStore.set({
    activeAssetManifestCid: "bafyParent",
    activeAssetName: "Parent World",
    activeAssetTokenId: "9",
    activeCollectionTokenId: "9",
    selectedCollectionId: "999",
  });

  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: {
      collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "5" },
      assetID: "a1",
    },
  });
  await waitFor(() => loadAssetManifestMock.mock.calls.length > 0);

  // Publish after the dive must target the child's collection (token 5),
  // not the parent's (9) or a stale selected collection (999).
  let s = assetStore.get();
  expect(s.activeCollectionTokenId).toBe("5");
  expect(s.selectedCollectionId).toBeNull();

  await ascendOneLevel();
  s = assetStore.get();
  expect(s.activeCollectionTokenId).toBe("9");
  expect(s.selectedCollectionId).toBeNull();
});

test("dive adopts the child's assetId so republish targets the child's own asset", async () => {
  const { ascendOneLevel } = await loadModule();
  _childManifest = { name: "Child Hub", asset_id: "asset_child_1" };

  assetStore.set({
    activeAssetManifestCid: "bafyParent",
    activeAssetName: "Parent World",
    activeAssetTokenId: "9",
    activeAssetId: "asset_parent_1",
  });

  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: {
      collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "5" },
      assetID: "asset_child_1",
    },
  });
  await waitFor(() => loadAssetManifestMock.mock.calls.length > 0);

  // Without the child's assetId, a republish after diving writes the child
  // version under the parent's assetID and child_ref viewers never update.
  expect(assetStore.get().activeAssetId).toBe("asset_child_1");

  await ascendOneLevel();
  expect(assetStore.get().activeAssetId).toBe("asset_parent_1");
});
