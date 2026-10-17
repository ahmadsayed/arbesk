// @test-env dom
/**
 * The scene loader applies the legacy-3MF placement conversion
 * (engine/legacy-3mf-placement.ts) on its two manifest read paths: a normal
 * asset load and a fork template read (insert as copy).
 */

import { beforeAll, beforeEach, expect, jest, mock, test } from "bun:test";
let sceneLoader;
const applyTransformMatrix = jest.fn();

const LEGACY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 22.875, 0, 1];
const MANIFESTS = {
  bafyGridfinity: {
    type: "asset",
    name: "gridfinity",
    timestamp: 1791298270184, // 2026-10-06, before 3MF renders moved to metres
    scene: {
      nodes: [
        {
          node_id: "gridfinity_node",
          source: { cid: "bafy3mf", path: "composite.3mf.json", format: "3mf" },
          transform_matrix: LEGACY_MATRIX,
        },
      ],
    },
  },
};

beforeAll(async () => {
  global.URL.createObjectURL = jest.fn(() => "blob:fake");
  global.URL.revokeObjectURL = jest.fn();
  global.BABYLON = {
    SceneLoader: {
      ImportMeshAsync: jest.fn().mockResolvedValue({
        meshes: [{ name: "m1", parent: null, metadata: null, isDisposed: () => false, dispose: jest.fn() }],
        transformNodes: [],
        animationGroups: [],
      }),
    },
  };

  await mock.module(
    "@arbesk/asset-core/events/bus.js",
    () => ({
      emit: jest.fn(),
      on: jest.fn(),
      EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
    })
  );
  await mock.module(
    "@arbesk/asset-core/domain/asset-store.js",
    () => ({ assetStore: { get: jest.fn(() => ({})), set: jest.fn() }, tagManifestCid: jest.fn() })
  );
  await mock.module(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({ walletState: { get: jest.fn(() => ({})) } })
  );
  await mock.module(
    "../../frontend/src/js/state/ui-state.js",
    () => ({ uiState: { set: jest.fn() } })
  );
  await mock.module(
    "../../frontend/src/js/engine/transforms.js",
    () => ({
      extractCid: (src) => (src && src.cid ? src.cid : src),
      detectAssetFormat: (src) => src?.format || "3mf",
      getManifestNodes: (m) => m?.scene?.nodes || [],
      applyTransformMatrix,
      applyDefaultMaterial: jest.fn(),
      centerImportedAsset: jest.fn(),
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/placeholders.js",
    () => ({ createPlaceholder: jest.fn(), disposePlaceholder: jest.fn() })
  );
  await mock.module(
    "../../frontend/src/js/engine/time-travel.js",
    () => ({ applyColor: jest.fn(), applyScale: jest.fn() })
  );
  await mock.module(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn(async (cid) => structuredClone(MANIFESTS[cid])),
      getArrayBufferFromRemoteIPFS: jest.fn(),
      getBlobFromRemoteIPFS: jest.fn(),
    })
  );
  await mock.module(
    "../../frontend/src/js/engine/anchor-node.js",
    () => ({ createAnchorNode: jest.fn(() => ({ parent: null, metadata: {} })) })
  );

  // A stub 3MF handler stands in for the built-in one (no IPFS fetch/parse).
  await mock.module(
    "../../frontend/src/js/formats/handlers/3mf-handler.js",
    () => ({
      threeMfHandler: {
        format: "3mf",
        extensions: [".3mf"],
        sniff: () => false,
        load: async (_src, ctx) => ctx.importFromBlob(new Blob(["x"]), ".gltf"),
        decomposeForSave: async () => null,
        isStoredForm: () => true,
        isDedupSource: () => false,
      },
    })
  );
  sceneLoader = await import("../../frontend/src/js/engine/scene-loader.js");
});

beforeEach(() => applyTransformMatrix.mockClear());

test("loading a pre-cutoff 3MF asset places it in metres", async () => {
  await sceneLoader.loadAssetManifest("bafyGridfinity", { parent: null, metadata: {} }, 1);
  const calls = applyTransformMatrix.mock.calls.filter(([, m]) => Array.isArray(m));
  expect(calls).toHaveLength(1);
  expect(calls[0][1][13]).toBeCloseTo(0.022875, 9);
});
