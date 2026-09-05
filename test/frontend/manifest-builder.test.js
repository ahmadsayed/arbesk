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
  jest.unstable_mockModule("@arbesk/asset-core/formats/gltf/decomposer.js", () => ({
    isComposite: jest.fn(),
    // Imported (unused) by asset-core/executor/inline.ts — the mock must
    // satisfy the full link-time surface of the decomposer module.
    decompose: jest.fn(),
  }));
  jest.unstable_mockModule("@arbesk/asset-core/formats/gltf/async-gltf.js", () => ({
    composeAsync: jest.fn(),
    decomposeAsync: jest.fn(),
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
  const asyncGltf = await import("@arbesk/asset-core/formats/gltf/async-gltf.js");
  const decomposer = await import("@arbesk/asset-core/formats/gltf/decomposer.js");
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
    ctx.asyncGltf.decomposeAsync.mockReset();
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
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

    // computeAssetStats fetches the root source composite to recompute
    // metadata.computed; return null so it yields no stats and this test stays
    // focused on the manifest-cache path.
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(null);

    const result = await ctx.mod.prepareManifestForWrite("Cached Asset");

    // The manifest came from the in-memory cache, not IPFS: the only IPFS call
    // is computeAssetStats' source-composite fetch, which targets the source
    // CID (bafyCached), never the manifest CID (bafyManifest).
    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalledWith("bafyManifest");
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

    // Chat provenance is dropped when no prompts were consumed; metadata.computed
    // is always recomputed and remains present.
    expect(result.manifest.metadata.chat).toBeUndefined();
    expect(result.manifest.metadata.computed).toBeDefined();
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
        getPendingChildRefRemovals: jest.fn().mockReturnValue(new Set()),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest.fn().mockReturnValue(new Map()),
        clearPendingSourceOverrides: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
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
        getPendingChildRefRemovals: jest.fn().mockReturnValue(new Set()),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest.fn().mockReturnValue(new Map()),
        clearPendingSourceOverrides: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
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

  // Viewport file-drop override: baking replaces the node's source and resets
  // its post_processor (the old edits described the old geometry), and the
  // save must be detected as a change, not a no-op — the override bake happens
  // after the prevManifest no-op baseline snapshot, same as pending child refs.
  // NOTE: keep the scene-graph-mocking tests at the END of this describe —
  // the mock survives jest.resetModules() and would leak into earlier tests.
  it("bakes a source override into an existing node and resets its post_processor", async () => {
    const override = {
      source: { cid: "bafyDropped", path: "composite.gltf", format: "gltf" },
      name: "dropped-model",
    };
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue([]),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        getPendingChildRefRemovals: jest.fn().mockReturnValue(new Set()),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest
          .fn()
          .mockReturnValue(new Map([["n1", override]])),
        clearPendingSourceOverrides: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
    stateMod._resetForTesting();
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    writeJSONToIPFS.mockResolvedValue("bafyOverrideVersion");

    const overriddenNode = makeNode();
    overriddenNode.post_processor = {
      color: "#ff0000",
      scale: { x: 2, y: 2, z: 2 },
    };
    const manifest = makeManifest([overriddenNode]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    stateMod.assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.saveAssetDraftCore("Draft");

    expect(result.ok).toBe(true);
    const written = writeJSONToIPFS.mock.calls[0][0];
    const node = written.scene.nodes.find((n) => n.node_id === "n1");
    expect(node.source).toEqual(override.source);
    expect(node.post_processor).toEqual({
      color: null,
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  // Viewport file drop with no asset open: the staged override alone must
  // produce a fresh single-node manifest (node_1) that is written, not
  // swallowed by first-save no-op detection.
  it("creates a fresh single-node manifest from a source override with no asset open", async () => {
    const override = {
      source: { cid: "bafyDropped", path: "composite.gltf", format: "gltf" },
      name: "dropped-model",
    };
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue([]),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        getPendingChildRefRemovals: jest.fn().mockReturnValue(new Set()),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest
          .fn()
          .mockReturnValue(new Map([["node_1", override]])),
        clearPendingSourceOverrides: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
    stateMod._resetForTesting();
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    writeJSONToIPFS.mockResolvedValue("bafyFreshDraft");
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);

    const result = await ctx.mod.saveAssetDraftCore("dropped-model");

    expect(result.ok).toBe(true);
    expect(result.cid).toBe("bafyFreshDraft");
    const written = writeJSONToIPFS.mock.calls[0][0];
    expect(written.scene.nodes).toHaveLength(1);
    expect(written.scene.nodes[0]).toEqual({
      node_id: "node_1",
      type: "source_asset",
      name: "dropped-model",
      source: override.source,
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      post_processor: { color: null, scale: { x: 1, y: 1, z: 1 } },
    });
  });

  // Child-asset unlink (TODO #18): a saved child_ref marked for removal must
  // be filtered out of the written manifest, and the removal must be detected
  // as a change (not a no-op) — the filter runs after the prevManifest snapshot.
  it("drops a child asset marked for removal and writes the change", async () => {
    const savedChild = {
      node_id: "linked_child_1",
      type: "child_ref",
      child_ref: {
        collection: { chainId: 31337, contractAddress: "0xabc", tokenId: "1" },
        assetID: "asset_child",
      },
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue([]),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        getPendingChildRefRemovals: jest
          .fn()
          .mockReturnValue(new Set(["linked_child_1"])),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest.fn().mockReturnValue(new Map()),
        clearPendingSourceOverrides: jest.fn(),
        captureAssetThumbnail: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
    stateMod._resetForTesting();
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    writeJSONToIPFS.mockResolvedValue("bafyRemovalVersion");

    const manifest = makeManifest([makeNode(), savedChild]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    stateMod.assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.saveAssetDraftCore("Draft");

    expect(result.ok).toBe(true);
    expect(result.cid).toBe("bafyRemovalVersion");
    const written = writeJSONToIPFS.mock.calls[0][0];
    expect(
      written.scene.nodes.some((n) => n.node_id === "linked_child_1")
    ).toBe(false);
    expect(written.scene.nodes.some((n) => n.node_id === "n1")).toBe(true);
  });
});

// =====================================================================
// prepareManifestForWrite — edit-baking branches
//
// Characterization for the source-color / post-processor / transform edit
// branches the earlier tests do not reach. These MUST stay at the END of the
// file: jest.unstable_mockModule registrations survive jest.resetModules() and
// would leak into earlier tests.
// =====================================================================
describe("prepareManifestForWrite — edit-baking branches", () => {
  /**
   * Register the engine-module mocks (scene-graph, parametric-preview,
   * asset-file-drop) that prepareManifestForWrite's edit-baking branches read.
   * Call BEFORE load().
   */
  function mockEngineModules({
    pendingChildRefs = [],
    pendingPP = new Map(),
    pendingTransforms = new Map(),
    pendingColors = new Map(),
    pendingOverrides = new Map(),
    pendingRemovals = new Set(),
  } = {}) {
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn().mockReturnValue(pendingChildRefs),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(pendingPP),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(pendingTransforms),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        getPendingChildRefRemovals: jest.fn().mockReturnValue(pendingRemovals),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest.fn().mockReturnValue(pendingOverrides),
        clearPendingSourceOverrides: jest.fn(),
        captureAssetThumbnail: jest.fn(),
        getNodeMeshes: jest.fn(),
        getNodeSubMeshes: jest.fn(),
        getNodeChildRef: jest.fn(),
        deselectAll: jest.fn(),
        selectNodeById: jest.fn(),
        selectSubMesh: jest.fn(),
        state: { selectedNodeIds: new Set() },
      })
    );
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/parametric-preview.js",
      () => ({
        getPendingSourceColorEdits: jest.fn().mockReturnValue(pendingColors),
        clearPendingSourceColorEdits: jest.fn(),
        clearPendingSourceColorEdit: jest.fn(),
      })
    );
    jest.unstable_mockModule(
      "../../frontend/src/js/services/asset-file-drop.js",
      () => ({
        handleAssetFileDropped: jest.fn(),
        waitForPendingFileDrops: jest.fn().mockResolvedValue(undefined),
      })
    );
  }

  async function freshStore() {
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
    stateMod._resetForTesting();
    return stateMod.assetStore;
  }

  it("returns null when no asset is open and no edits are pending", async () => {
    mockEngineModules();
    const ctx = await load();
    await freshStore();

    const result = await ctx.mod.prepareManifestForWrite("Empty");

    expect(result).toBeNull();
  });

  it("bakes pending source-color edits into node sources", async () => {
    mockEngineModules({
      pendingColors: new Map([["n1", new Map([["Body", "#ff0000"]])]]),
    });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    ctx.gltfHandler.editSourceColors.mockResolvedValue({
      sourceCid: "bafyColored",
      format: "gltf",
      path: "composite.gltf",
      modified: true,
      skipped: false,
    });
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Colored");

    expect(result.manifest.scene.nodes[0].source).toEqual({
      cid: "bafyColored",
      path: "composite.gltf",
      format: "gltf",
    });
    expect(result.manifest.version).toBe(2);
    expect(ctx.gltfHandler.editSourceColors).toHaveBeenCalledTimes(1);
    expect(ctx.gltfHandler.editSourceColors.mock.calls[0][1]).toEqual({
      Body: "#ff0000",
    });
  });

  it("leaves the source unchanged when a format has no editSourceColors hook", async () => {
    mockEngineModules({
      pendingColors: new Map([["n1", new Map([["Body", "#ff0000"]])]]),
    });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    ctx.gltfHandler.editSourceColors = undefined;
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Unsupported");

    expect(result.manifest.scene.nodes[0].source.cid).toBe("bafyCached");
  });

  // KNOWN GAP: rate-limit errors are absorbed by Promise.allSettled inside the
  // bake helpers, so a 429 does NOT propagate to the caller — it silently skips
  // the affected node. This pins the current behavior; propagation is a separate
  // decision, not part of this complexity refactor.
  it("leaves the source unchanged when source-color baking fails (non-rate-limit)", async () => {
    mockEngineModules({
      pendingColors: new Map([["n1", new Map([["Body", "#ff0000"]])]]),
    });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    ctx.gltfHandler.editSourceColors.mockRejectedValue(new Error("boom"));
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Failed");

    expect(result.manifest.scene.nodes[0].source.cid).toBe("bafyCached");
  });

  it("bakes composite post-processor colors into a decomposed node", async () => {
    mockEngineModules({
      pendingPP: new Map([["n1", { color: "#00ff00" }]]),
    });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    ctx.gltfHandler.editCompositeColors.mockResolvedValue({
      compositeCid: "bafyCompositeColored",
    });
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("PP Composite");

    expect(result.manifest.scene.nodes[0].source.cid).toBe("bafyCompositeColored");
    expect(ctx.gltfHandler.editCompositeColors).toHaveBeenCalledTimes(1);
  });

  it("stores a post-processor overlay on a monolithic node", async () => {
    mockEngineModules({
      pendingPP: new Map([
        [
          "n1",
          {
            color: "#ff0000",
            scale: { x: 2, y: 2, z: 2 },
            meshOverrides: { Body: "#0000ff" },
          },
        ],
      ]),
    });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "asset.gltf", format: "gltf" }),
    ]);
    // Monolithic: not stored form, so no composite bake.
    ctx.gltfHandler.isStoredForm.mockReturnValue(false);
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("PP Overlay");

    expect(result.manifest.scene.nodes[0].post_processor).toEqual({
      color: "#ff0000",
      scale: { x: 2, y: 2, z: 2 },
      meshOverrides: { Body: "#0000ff" },
    });
  });

  it("applies transform edits to node transform_matrix", async () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2];
    mockEngineModules({ pendingTransforms: new Map([["n1", matrix]]) });
    const ctx = await load();
    const store = await freshStore();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    store.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Transformed");

    expect(result.manifest.scene.nodes[0].transform_matrix).toEqual(matrix);
  });
  // Race regression (seen on testnet/Pinata): a save snapshots the pending
  // child refs it bakes; a linked-asset drop that lands WHILE the save is
  // still writing must stay pending — the trailing clear must not wipe it.
  // NOTE: keep LAST — the scene-graph mock leaks across resetModules.
  it("keeps a child ref that lands while the save is in flight", async () => {
    const childA = {
      node_id: "linked_child_A",
      type: "child_ref",
      child_ref: {
        collection: { chainId: 31337, contractAddress: "0xabc", tokenId: "1" },
        assetID: "asset_child_a",
      },
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };
    const childB = { ...childA, node_id: "linked_child_B" };
    const livePending = [childA];
    jest.unstable_mockModule(
      "../../frontend/src/js/engine/scene-graph.js",
      () => ({
        getPendingChildRefs: jest.fn(() => livePending),
        waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
        getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingPostProcessorEdits: jest.fn(),
        getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
        clearPendingTransformEdits: jest.fn(),
        clearPendingChildRefs: jest.fn(),
        getPendingChildRefRemovals: jest.fn().mockReturnValue(new Set()),
        clearPendingChildRefRemovals: jest.fn(),
        getPendingSourceOverrides: jest.fn().mockReturnValue(new Map()),
        clearPendingSourceOverrides: jest.fn(),
        captureAssetThumbnail: jest.fn(),
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
    const stateMod = await import("@arbesk/asset-core/domain/asset-store.js");
    stateMod._resetForTesting();
    const { writeJSONToIPFS } = await import(
      "../../frontend/src/js/ipfs/write-to-ipfs.js"
    );
    // Block the IPFS write until the test releases it — the save is in flight.
    let releaseWrite;
    writeJSONToIPFS.mockImplementation(
      () => new Promise((resolve) => { releaseWrite = () => resolve("bafyNewVersion"); })
    );

    const manifest = makeManifest([makeNode()]);
    ctx.gltfHandler.isStoredForm.mockReturnValue(true);
    stateMod.assetStore.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const savePromise = ctx.mod.saveAssetDraftCore("Draft");
    while (writeJSONToIPFS.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // The drop lands mid-save (testnet-scale latency).
    livePending.push(childB);
    releaseWrite();
    const result = await savePromise;

    expect(result.ok).toBe(true);
    // A was baked and cleared; B survived for the next save.
    const written = writeJSONToIPFS.mock.calls[0][0];
    expect(written.scene.nodes.some((n) => n.node_id === "linked_child_A")).toBe(true);
    expect(written.scene.nodes.some((n) => n.node_id === "linked_child_B")).toBe(false);
    expect(livePending.map((n) => n.node_id)).toEqual(["linked_child_B"]);
  });

});
