/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();

  jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
      getFromRemoteIPFS: jest.fn(),
      getBase64FromRemoteIPFS: jest.fn(),
      getBlobFromRemoteIPFS: jest.fn(),
      getArrayBufferFromRemoteIPFS: jest.fn(),
      getRawArrayBufferFromRemoteIPFS: jest.fn(),
      getManifestChain: jest.fn(),
      isIpfsCidReachable: jest.fn(),
    })
  );
  jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/write-to-ipfs.js",
    () => ({
      writeToIPFS: jest.fn(),
      writeJSONToIPFS: jest.fn(),
    })
  );
  jest.unstable_mockModule("../../frontend/src/js/gltf/decomposer.js", () => ({
    isComposite: jest.fn(),
  }));
  jest.unstable_mockModule("../../frontend/src/js/gltf/async-gltf.js", () => ({
    composeGlTFAsync: jest.fn(),
    composeGlTFToBlobAsync: jest.fn(),
    decomposeGlTFAsync: jest.fn(),
    decomposeAndStoreAsync: jest.fn(),
    decomposeGLBAsync: jest.fn(),
    editSourceColorsAsync: jest.fn(),
    isComposite: jest.fn(),
  }));
  jest.unstable_mockModule(
    "../../frontend/src/js/formats/handlers/gltf-handler.js",
    () => ({
      gltfHandler: {
        format: "gltf",
        extensions: [".gltf"],
        load: jest.fn(),
        decomposeForSave: jest.fn(),
        isStoredForm: jest.fn(),
        isDedupSource: jest.fn(),
        editSourceColors: jest.fn(),
        editCompositeColors: jest.fn(),
      },
    })
  );
  jest.unstable_mockModule(
    "../../frontend/src/js/formats/handlers/glb-handler.js",
    () => ({
      glbHandler: {
        format: "glb",
        extensions: [".glb"],
        sniff: jest.fn(),
        load: jest.fn(),
        decomposeForSave: jest.fn(),
        isStoredForm: jest.fn().mockReturnValue(false),
        isDedupSource: jest.fn().mockReturnValue(false),
        editSourceColors: jest.fn(),
      },
    })
  );
  jest.unstable_mockModule("../../frontend/src/js/utils/log.js", () => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  const mod = await import(
    "../../frontend/src/js/services/asset-save/manifest-builder.js"
  );
  const remote = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  const asyncGltf = await import("../../frontend/src/js/gltf/async-gltf.js");
  const decomposer = await import("../../frontend/src/js/gltf/decomposer.js");
  const { gltfHandler } = await import(
    "../../frontend/src/js/formats/handlers/gltf-handler.js"
  );
  const { glbHandler } = await import(
    "../../frontend/src/js/formats/handlers/glb-handler.js"
  );
  return { mod, remote, asyncGltf, decomposer, gltfHandler, glbHandler };
}

function makeManifest(nodes = []) {
  return {
    asset_id: "asset_1",
    name: "Test Asset",
    version: 1,
    scene: { nodes },
  };
}

function makeNode({ nodeId = "n1", path = "composite.gltf", format = "gltf", cid = "bafyComposite" } = {}) {
  return {
    node_id: nodeId,
    type: "source_asset",
    source: { cid, path, format },
  };
}

describe("decomposeManifestNodes", () => {
  let ctx;

  beforeEach(async () => {
    ctx = await load();
    ctx.remote.getFromRemoteIPFS.mockReset();
    ctx.remote.getArrayBufferFromRemoteIPFS.mockReset();
    ctx.asyncGltf.decomposeAndStoreAsync.mockReset();
    ctx.asyncGltf.decomposeGLBAsync.mockReset();
    ctx.decomposer.isComposite.mockReset();
    ctx.gltfHandler.decomposeForSave.mockReset();
    ctx.gltfHandler.isStoredForm.mockReset();
    ctx.gltfHandler.isDedupSource.mockReset();
    ctx.glbHandler.decomposeForSave.mockReset();
    ctx.glbHandler.isStoredForm.mockReset();
    ctx.glbHandler.isDedupSource.mockReset();
  });

  it("skips stored-form nodes with no pending color edits", async () => {
    const manifest = makeManifest([makeNode()]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(count).toBe(0);
    expect(ctx.gltfHandler.decomposeForSave).not.toHaveBeenCalled();
    expect(ctx.glbHandler.decomposeForSave).not.toHaveBeenCalled();
  });

  it("decomposes a stored-form node when a source-color edit is pending", async () => {
    const manifest = makeManifest([makeNode()]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    ctx.gltfHandler.decomposeForSave.mockResolvedValue({
      cid: "bafyComposite",
      path: "composite.gltf",
      format: "gltf",
      normalizeOnly: true,
    });
    const pending = new Map([["n1", new Map([["Body", "#ff0000"]])]]);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map(), pending);

    expect(ctx.gltfHandler.decomposeForSave).toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("decomposes a GLB source node", async () => {
    const manifest = makeManifest([
      makeNode({ format: "glb", path: "asset.glb", cid: "bafyGlb" }),
    ]);
    ctx.glbHandler.decomposeForSave.mockResolvedValue({
      cid: "bafyGlbComposite",
      path: "composite.gltf",
      format: "gltf",
    });

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.glbHandler.decomposeForSave).toHaveBeenCalled();
    expect(count).toBe(1);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyGlbComposite",
      path: "composite.gltf",
      format: "gltf",
    });
  });

  it("decomposes a monolithic glTF source node", async () => {
    const manifest = makeManifest([
      makeNode({ format: "gltf", path: "asset.gltf", cid: "bafyMono" }),
    ]);
    ctx.gltfHandler.decomposeForSave.mockResolvedValue({
      cid: "bafyMonoComposite",
      path: "composite.gltf",
      format: "gltf",
    });

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.gltfHandler.decomposeForSave).toHaveBeenCalled();
    expect(count).toBe(1);
    expect(manifest.scene.nodes[0].source.cid).toBe("bafyMonoComposite");
  });

  it("skips child_ref nodes regardless of source shape", async () => {
    const manifest = makeManifest([
      {
        node_id: "n1",
        type: "child_ref",
        child_ref: { chainId: 1, tokenId: "123" },
        source: { cid: "bafyChild", path: "composite.gltf", format: "gltf" },
      },
    ]);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(count).toBe(0);
    expect(ctx.gltfHandler.decomposeForSave).not.toHaveBeenCalled();
  });

  it("normalizes path for an already-composite source that lacks the composite marker", async () => {
    const manifest = makeManifest([
      makeNode({ format: "gltf", path: "asset.gltf", cid: "bafyOldComposite" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(false);
    ctx.gltfHandler.decomposeForSave.mockResolvedValue({
      cid: "bafyOldComposite",
      path: "composite.gltf",
      format: "gltf",
      normalizeOnly: true,
    });

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.gltfHandler.decomposeForSave).toHaveBeenCalled();
    expect(count).toBe(0);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyOldComposite",
      path: "composite.gltf",
      format: "gltf",
    });

    // A second call should now use the fast path and avoid any fetch.
    ctx.gltfHandler.decomposeForSave.mockClear();
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    const count2 = await ctx.mod.decomposeManifestNodes(manifest, new Map());
    expect(count2).toBe(0);
    expect(ctx.gltfHandler.decomposeForSave).not.toHaveBeenCalled();
  });
});

describe("prepareManifestForWrite", () => {
  let ctx;
  let assetStore;

  beforeEach(async () => {
    ctx = await load();
    const stateMod = await import("../../frontend/src/js/domain/asset-store.js");
    assetStore = stateMod.assetStore;
    stateMod._resetForTesting();
  });

  it("uses the in-memory manifest cache instead of fetching from IPFS", async () => {
    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Cached Asset");

    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalled();
    expect(result.manifest.scene.nodes[0].source.cid).toBe("bafyCached");
    expect(result.manifest._manifestCid).toBeUndefined();
  });

  it("falls back to IPFS when the cached manifest CID does not match", async () => {
    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(manifest);
    assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyOtherManifest" },
    });

    await ctx.mod.prepareManifestForWrite("Fetched Asset");

    expect(ctx.remote.getFromRemoteIPFS).toHaveBeenCalledWith("bafyManifest");
  });

  // Regression: the first save of a fresh draft (latestCid === activeCid) with a
  // GLB source node that decompose converts to composite.gltf must NOT be seen
  // as "no changes". prevManifest is the no-op-detection baseline; it has to be
  // a snapshot taken BEFORE decomposeManifestNodes() mutates the manifest in
  // place, otherwise it aliases the live manifest and the equality check
  // compares the manifest against itself (always equal), so the save is dropped
  // and the studio URL never advances.
  it("keeps prevManifest as a pre-decompose snapshot so a decomposed save is detected as changed", async () => {
    const manifest = makeManifest([
      makeNode({ format: "glb", path: "asset.glb", cid: "bafyGlb" }),
    ]);
    assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });
    ctx.glbHandler.decomposeForSave.mockResolvedValue({
      cid: "bafyGlbComposite",
      path: "composite.gltf",
      format: "gltf",
    });

    const result = await ctx.mod.prepareManifestForWrite("Draft");

    // Prepared manifest reflects the decomposed source…
    expect(result.manifest.scene.nodes[0].source.cid).toBe("bafyGlbComposite");
    // …while prevManifest still holds the original GLB (pristine snapshot).
    expect(result.prevManifest.scene.nodes[0].source.cid).toBe("bafyGlb");
    // …so the change is detectable and the save is not a false no-op.
    expect(
      ctx.mod.manifestsSemanticallyEqual(result.manifest, result.prevManifest)
    ).toBe(false);
  });

  it("records sent pending generations as version-scoped metadata.chat", async () => {
    const pg = await import(
      "../../frontend/src/js/state/pending-generations.js"
    );
    pg._resetPendingGenerations();
    const sentId = pg.addPendingGeneration({
      assetManifestCid: "bafyManifest",
      sourceAssetCid: "src-gen",
      prompt: "a low-poly cabin",
      prevAssetManifestCid: null,
      provider: "mock",
      task: "model",
      taskId: "tripo-task-9",
    });
    pg.updatePendingGeneration(sentId, { status: "sent" });
    // Stays "pending" — must NOT be recorded.
    pg.addPendingGeneration({
      assetManifestCid: "cid-draft",
      sourceAssetCid: "src-draft",
      prompt: "discarded draft",
      prevAssetManifestCid: null,
      provider: "mock",
      task: "model",
    });
    // Sent, but belongs to a different asset's chain — must NOT be recorded.
    const otherId = pg.addPendingGeneration({
      assetManifestCid: "bafyOtherAsset",
      sourceAssetCid: "src-other",
      prompt: "prompt for another asset",
      prevAssetManifestCid: null,
      provider: "mock",
      task: "model",
    });
    pg.updatePendingGeneration(otherId, { status: "sent" });

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    // Stale entries from the previous version must be dropped (version-scoped).
    manifest.metadata = {
      chat: [{ prompt: "old version prompt", provider: "mock", task: "model", timestamp: 1 }],
    };
    assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Chat Asset");

    expect(result.manifest.metadata.chat).toHaveLength(1);
    const entry = result.manifest.metadata.chat[0];
    expect(entry.prompt).toBe("a low-poly cabin");
    expect(entry.provider).toBe("mock");
    expect(entry.task).toBe("model");
    expect(entry.taskId).toBe("tripo-task-9");
    expect(typeof entry.timestamp).toBe("number");
    expect(pg.getPendingGeneration(sentId).recorded).toBe(true);
    expect(pg.getPendingGeneration(otherId).recorded).toBeUndefined();
  });

  it("omits metadata when no prompts were consumed", async () => {
    const pg = await import(
      "../../frontend/src/js/state/pending-generations.js"
    );
    pg._resetPendingGenerations();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    manifest.metadata = {
      chat: [{ prompt: "old", provider: "mock", task: "model", timestamp: 1 }],
    };
    assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("No Chat Asset");

    expect(result.manifest.metadata).toBeUndefined();
  });

  // Regression: stored-form 3MF nodes have no editCompositeColors hook —
  // color edits must stay post_processor overlays, not be sent to the bake
  // branch where the null result silently drops them.
  // NOTE: keep this test LAST in the describe — the scene-graph mock below
  // survives jest.resetModules() and would leak into later tests.
  it("keeps color edits as overlays for stored-form 3MF nodes", async () => {
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue([]),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest
          .fn()
          .mockReturnValue(new Map([["n1", { color: "#ff0000" }]])),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        captureAssetThumbnail: jest.fn(),
        // parametric-preview.js / time-travel.js are pulled in transitively
        // by manifest-builder and also import scene-graph — ESM linking
        // requires every named import to exist on the mocked module.
        getNodeMeshes: jest.fn(),
        getNodeSubMeshes: jest.fn(),
        getNodeChildRef: jest.fn(),
        deselectAll: jest.fn(),
        selectNodeById: jest.fn(),
        selectSubMesh: jest.fn(),
        state: { selectedNodeIds: new Set() },
      })
    );
    const ctx = await load();

    const manifest = makeManifest([
      makeNode({
        nodeId: "n1",
        cid: "bafyComposite3mf",
        path: "composite.3mf.json",
        format: "3mf",
      }),
    ]);
    const stateMod = await import("../../frontend/src/js/domain/asset-store.js");
    stateMod._resetForTesting();
    stateMod.assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("3MF Asset");

    expect(
      result.manifest.scene.nodes[0].post_processor?.color
    ).toBe("#ff0000");
  });

  // Regression: pending linked-child refs must be baked into the manifest
  // AFTER the prevManifest no-op baseline snapshot. When the bake happened
  // before the snapshot, the baseline already contained the child, so
  // "link a child → Save" on an otherwise unedited (e.g. auto-saved) draft
  // was wrongly reported as "no changes" and the child was never written.
  // NOTE: keep this test LAST in the describe — the scene-graph mock below
  // survives jest.resetModules() and would leak into later tests.
  it("treats a pending linked child as a change on an otherwise unedited draft", async () => {
    const childRefNode = {
      node_id: "linked_child_1",
      type: "child_ref",
      child_ref: {
        collection: {
          chainId: 31337,
          contractAddress: "0xabc",
          tokenId: "1",
        },
        assetID: "asset_child",
      },
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue([childRefNode]),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        captureAssetThumbnail: jest.fn(),
        // See the 3MF test above: transitively imported named exports must
        // all exist on the mocked module for ESM linking.
        getNodeMeshes: jest.fn(),
        getNodeSubMeshes: jest.fn(),
        getNodeChildRef: jest.fn(),
        deselectAll: jest.fn(),
        selectNodeById: jest.fn(),
        selectSubMesh: jest.fn(),
        state: { selectedNodeIds: new Set() },
      })
    );
    const ctx = await load();
    const stateMod = await import("../../frontend/src/js/domain/asset-store.js");
    stateMod._resetForTesting();
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    writeJSONToIPFS.mockResolvedValue("bafyNewVersion");

    // Auto-saved baseline: one stored composite node, no pending edits —
    // without the child ref this save would be a no-op.
    const manifest = makeManifest([makeNode()]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    stateMod.assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.saveAssetDraftCore("Draft");

    expect(result.ok).toBe(true);
    expect(result.cid).toBe("bafyNewVersion");
    const written = writeJSONToIPFS.mock.calls[0][0];
    expect(
      written.scene.nodes.some((n) => n.node_id === "linked_child_1")
    ).toBe(true);
  });
});
