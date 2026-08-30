/**
 * @jest-environment jsdom
 *
 * importFromBlob must surface the GLB's animation groups and loadAsset must
 * store them per nodeId so the inspector can offer animation previews.
 * disposeNode / clearScene must dispose the groups with the node.
 */
import { jest, expect, test, beforeAll } from "@jest/globals";

let sceneLoader, cleanup, state, registerFormatHandler;
const fakeGroups = [
  { name: "spin", stop: jest.fn(), reset: jest.fn(), isDisposed: () => false, dispose: jest.fn() },
  { name: "bob", stop: jest.fn(), reset: jest.fn(), isDisposed: () => false, dispose: jest.fn() },
];

beforeAll(async () => {
  global.URL.createObjectURL = jest.fn(() => "blob:fake");
  global.URL.revokeObjectURL = jest.fn();
  global.BABYLON = {
    SceneLoader: {
      ImportMeshAsync: jest.fn().mockResolvedValue({
        meshes: [{ name: "m1", parent: null, metadata: null, isDisposed: () => false, dispose: jest.fn() }],
        transformNodes: [],
        animationGroups: fakeGroups,
      }),
    },
  };

  await jest.unstable_mockModule(
    "@arbesk/asset-core/events/bus.js",
    () => ({
      emit: jest.fn(),
      on: jest.fn(),
      EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
    })
  );
  await jest.unstable_mockModule(
    "@arbesk/asset-core/domain/asset-store.js",
    () => ({ assetStore: { get: jest.fn(() => ({})), set: jest.fn() }, tagManifestCid: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({ walletState: { get: jest.fn(() => ({})) } })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/ui-state.js",
    () => ({ uiState: { set: jest.fn() } })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/transforms.js",
    () => ({
      extractCid: (src) => (src && src.cid ? src.cid : src),
      detectAssetFormat: () => "testanim",
      getManifestNodes: (m) => m?.scene?.nodes || [],
      applyTransformMatrix: jest.fn(),
      applyDefaultMaterial: jest.fn(),
      centerImportedAsset: jest.fn(),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/placeholders.js",
    () => ({ createPlaceholder: jest.fn(), disposePlaceholder: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ applyColor: jest.fn(), applyScale: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/anchor-node.js",
    () => ({ createAnchorNode: jest.fn(() => ({ parent: null, metadata: {} })) })
  );

  // index registers the built-in handlers; registerFormatHandler lives in registry
  await import("../../frontend/src/js/formats/index.js");
  ({ registerFormatHandler } = await import(
    "../../frontend/src/js/formats/registry.js"
  ));
  registerFormatHandler({
    format: "testanim",
    extensions: [".testanim"],
    sniff: () => false,
    load: async (_src, ctx) => ctx.importFromBlob(new Blob(["x"]), ".testanim"),
    decomposeForSave: async () => null,
    isStoredForm: () => true,
    isDedupSource: () => false,
  });

  sceneLoader = await import("../../frontend/src/js/engine/scene-loader.js");
  cleanup = await import("../../frontend/src/js/engine/cleanup.js");
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
});

const SRC = { cid: "bafyAnim", path: "model.testanim", format: "testanim" };

test("loadAsset stores animation groups per nodeId", async () => {
  const parent = { parent: null, metadata: {} };
  await sceneLoader.loadAsset(SRC, parent, "nodeAnim1");
  expect(state.nodeAnimationGroups.get("nodeAnim1")).toEqual(fakeGroups);
  expect(state.nodeMeshes.get("nodeAnim1")).toHaveLength(1);
});

test("disposeNode disposes and removes the node's animation groups", async () => {
  await sceneLoader.loadAsset(SRC, { parent: null, metadata: {} }, "nodeAnim2");
  cleanup.disposeNode("nodeAnim2");
  for (const g of fakeGroups) expect(g.dispose).toHaveBeenCalled();
  expect(state.nodeAnimationGroups.has("nodeAnim2")).toBe(false);
});

test("clearScene disposes all remaining animation groups", async () => {
  const extra = [{ name: "x", stop: jest.fn(), isDisposed: () => false, dispose: jest.fn() }];
  state.nodeAnimationGroups.set("nodeAnim3", extra);
  state.scene = { stopAllAnimations: jest.fn(), transformNodes: [], meshes: [] };
  cleanup.clearScene();
  expect(extra[0].dispose).toHaveBeenCalled();
  expect(state.nodeAnimationGroups.size).toBe(0);
  state.scene = null;
});
