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
      clearRemoteIPFSCache: jest.fn(),
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
  return { mod, remote, asyncGltf, decomposer };
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
  });

  it("skips IPFS fetch for composite-looking glTF nodes with no pending color edits", async () => {
    const manifest = makeManifest([makeNode()]);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(count).toBe(0);
    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalled();
    expect(ctx.remote.getArrayBufferFromRemoteIPFS).not.toHaveBeenCalled();
    expect(ctx.asyncGltf.decomposeAndStoreAsync).not.toHaveBeenCalled();
    expect(ctx.asyncGltf.decomposeGLBAsync).not.toHaveBeenCalled();
  });

  it("fetches and decomposes a composite-looking node when a source-color edit is pending", async () => {
    const manifest = makeManifest([makeNode()]);
    ctx.decomposer.isComposite.mockReturnValue(true);
    const pending = new Map([["n1", new Map([["Body", "#ff0000"]])]]);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map(), pending);

    expect(ctx.remote.getFromRemoteIPFS).toHaveBeenCalledWith("bafyComposite");
    expect(ctx.asyncGltf.decomposeAndStoreAsync).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("decomposes a GLB source node", async () => {
    const manifest = makeManifest([
      makeNode({ format: "glb", path: "asset.glb", cid: "bafyGlb" }),
    ]);
    ctx.asyncGltf.decomposeGLBAsync.mockResolvedValue({
      compositeCid: "bafyGlbComposite",
    });

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.remote.getArrayBufferFromRemoteIPFS).toHaveBeenCalledWith("bafyGlb");
    expect(ctx.asyncGltf.decomposeGLBAsync).toHaveBeenCalled();
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
    ctx.remote.getFromRemoteIPFS.mockResolvedValue({ asset: { version: "2.0" } });
    ctx.decomposer.isComposite.mockReturnValue(false);
    ctx.asyncGltf.decomposeAndStoreAsync.mockResolvedValue({
      compositeCid: "bafyMonoComposite",
    });

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.remote.getFromRemoteIPFS).toHaveBeenCalledWith("bafyMono");
    expect(ctx.asyncGltf.decomposeAndStoreAsync).toHaveBeenCalled();
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
    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalled();
  });

  it("normalizes path for an already-composite source that lacks the composite marker", async () => {
    const manifest = makeManifest([
      makeNode({ format: "gltf", path: "asset.gltf", cid: "bafyOldComposite" }),
    ]);
    ctx.remote.getFromRemoteIPFS.mockResolvedValue({
      asset: { version: "2.0" },
      buffers: [{ uri: "ipfs://bafyBuffer" }],
    });
    ctx.decomposer.isComposite.mockReturnValue(true);

    const count = await ctx.mod.decomposeManifestNodes(manifest, new Map());

    expect(ctx.remote.getFromRemoteIPFS).toHaveBeenCalledWith("bafyOldComposite");
    expect(ctx.asyncGltf.decomposeAndStoreAsync).not.toHaveBeenCalled();
    expect(count).toBe(0);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyOldComposite",
      path: "composite.gltf",
      format: "gltf",
    });

    // A second call should now use the fast path and avoid any fetch.
    ctx.remote.getFromRemoteIPFS.mockClear();
    const count2 = await ctx.mod.decomposeManifestNodes(manifest, new Map());
    expect(count2).toBe(0);
    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalled();
  });
});

describe("prepareManifestForWrite", () => {
  let ctx;
  let assetState;

  beforeEach(async () => {
    ctx = await load();
    const stateMod = await import("../../frontend/src/js/state/asset-state.js");
    assetState = stateMod.assetState;
    stateMod._resetForTesting();
  });

  it("uses the in-memory manifest cache instead of fetching from IPFS", async () => {
    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    assetState.set({
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
    assetState.set({
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
    assetState.set({
      activeAssetManifestCid: "bafyManifest",
      latestAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });
    ctx.asyncGltf.decomposeGLBAsync.mockResolvedValue({
      compositeCid: "bafyGlbComposite",
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
});
