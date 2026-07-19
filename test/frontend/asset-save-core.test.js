/**
 * @jest-environment jsdom
 *
 * saveAssetDraftCore flow tests
 *
 * Covers the save-flow parallelism contract:
 *   - thumbnail capture starts concurrently with manifest preparation
 *   - republish snapshots the comments archive BEFORE the manifest write so
 *     the manifest is uploaded to IPFS exactly once (not written, patched,
 *     and re-written)
 *   - archive snapshot failures never block the save
 */
import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();

  const mocks = {
    getFromRemoteIPFS: jest.fn(),
    writeJSONToIPFS: jest.fn(),
    snapshotCommentsArchive: jest.fn(),
    getTokenURI: jest.fn(),
    captureAssetThumbnail: jest.fn(),
    getPendingChildRefs: jest.fn().mockReturnValue([]),
    getPendingPostProcessorEdits: jest.fn().mockReturnValue(new Map()),
    getPendingTransformEdits: jest.fn().mockReturnValue(new Map()),
    getPendingSourceColorEdits: jest.fn().mockReturnValue(new Map()),
  };

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
    getFromRemoteIPFS: mocks.getFromRemoteIPFS,
    getBase64FromRemoteIPFS: jest.fn(),
    getBlobFromRemoteIPFS: jest.fn(),
    getArrayBufferFromRemoteIPFS: jest.fn(),
    getRawArrayBufferFromRemoteIPFS: jest.fn(),
    getManifestChain: jest.fn(),
    isIpfsCidReachable: jest.fn(),
  }));
  jest.unstable_mockModule("../../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
    writeToIPFS: jest.fn(),
    writeJSONToIPFS: mocks.writeJSONToIPFS,
  }));
  jest.unstable_mockModule("../../frontend/src/js/services/api.js", () => ({
    snapshotCommentsArchive: mocks.snapshotCommentsArchive,
  }));
  jest.unstable_mockModule("../../frontend/src/js/services/token.js", () => ({
    getTokenURI: mocks.getTokenURI,
  }));
  jest.unstable_mockModule("../../frontend/src/js/engine/scene-graph.js", () => ({
    getPendingChildRefs: mocks.getPendingChildRefs,
    waitForPendingLinkedDrops: jest.fn().mockResolvedValue(undefined),
    getPendingPostProcessorEdits: mocks.getPendingPostProcessorEdits,
    clearPendingPostProcessorEdits: jest.fn(),
    getPendingTransformEdits: mocks.getPendingTransformEdits,
    clearPendingTransformEdits: jest.fn(),
    clearPendingChildRefs: jest.fn(),
    captureAssetThumbnail: mocks.captureAssetThumbnail,
  }));
  jest.unstable_mockModule(
    "../../frontend/src/js/engine/parametric-preview.js",
    () => ({
      getPendingSourceColorEdits: mocks.getPendingSourceColorEdits,
      clearPendingSourceColorEdits: jest.fn(),
    })
  );
  jest.unstable_mockModule(
    "../../frontend/src/js/gltf/material-editor.js",
    () => ({
      editCompositeColors: jest.fn(),
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
  const stateMod = await import("../../frontend/src/js/state/asset-state.js");
  stateMod._resetForTesting();
  return { mod, mocks, assetState: stateMod.assetState };
}

function makeManifest() {
  return {
    type: "asset",
    asset_id: "asset_1",
    name: "Test Asset",
    version: 1,
    timestamp: 111,
    scene: {
      nodes: [
        {
          node_id: "n1",
          transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          source: { cid: "bafyComposite", path: "composite.gltf", format: "gltf" },
        },
      ],
    },
  };
}

/**
 * Seed the in-memory manifest cache so prepareManifestForWrite needs no IPFS
 * fetch, and add a pending transform edit so the save is not a no-op.
 */
function seedChangedSave({ assetState, mocks }) {
  const manifest = makeManifest();
  assetState.set({
    activeAssetManifestCid: "bafyActive",
    latestAssetManifestCid: "bafyActive",
    currentManifest: { ...manifest, _manifestCid: "bafyActive" },
  });
  mocks.getPendingTransformEdits.mockReturnValue(
    new Map([["n1", [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]]])
  );
  return manifest;
}

describe("saveAssetDraftCore", () => {
  it("republish embeds the comments archive CID and writes the manifest exactly once", async () => {
    const ctx = await load();
    seedChangedSave(ctx);
    ctx.mocks.snapshotCommentsArchive.mockResolvedValue({ cid: "bafyArchive" });
    ctx.mocks.writeJSONToIPFS.mockResolvedValue("bafyNewManifest");

    const result = await ctx.mod.saveAssetDraftCore("Test Asset", {
      publishContext: { tokenId: "7", chainId: 31337 },
    });

    expect(result.ok).toBe(true);
    expect(result.cid).toBe("bafyNewManifest");
    expect(ctx.mocks.snapshotCommentsArchive).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: "7", assetId: "asset_1" })
    );
    expect(ctx.mocks.writeJSONToIPFS).toHaveBeenCalledTimes(1);
    const writtenManifest = ctx.mocks.writeJSONToIPFS.mock.calls[0][0];
    expect(writtenManifest.comments_archive_cid).toBe("bafyArchive");
  });

  it("still writes the manifest once (without archive CID) when the snapshot fails", async () => {
    const ctx = await load();
    seedChangedSave(ctx);
    ctx.mocks.snapshotCommentsArchive.mockRejectedValue(new Error("nostr down"));
    ctx.mocks.writeJSONToIPFS.mockResolvedValue("bafyNewManifest");

    const result = await ctx.mod.saveAssetDraftCore("Test Asset", {
      publishContext: { tokenId: "7", chainId: 31337 },
    });

    expect(result.ok).toBe(true);
    expect(ctx.mocks.writeJSONToIPFS).toHaveBeenCalledTimes(1);
    const writtenManifest = ctx.mocks.writeJSONToIPFS.mock.calls[0][0];
    expect(writtenManifest.comments_archive_cid).toBeUndefined();
  });

  it("does not snapshot the comments archive on a plain draft save", async () => {
    const ctx = await load();
    seedChangedSave(ctx);
    ctx.mocks.writeJSONToIPFS.mockResolvedValue("bafyNewManifest");

    const result = await ctx.mod.saveAssetDraftCore("Test Asset");

    expect(result.ok).toBe(true);
    expect(ctx.mocks.snapshotCommentsArchive).not.toHaveBeenCalled();
    expect(ctx.mocks.writeJSONToIPFS).toHaveBeenCalledTimes(1);
  });

  it("does not write or snapshot when nothing changed", async () => {
    const ctx = await load();
    const manifest = makeManifest();
    ctx.assetState.set({
      activeAssetManifestCid: "bafyActive",
      latestAssetManifestCid: "bafyActive",
      currentManifest: { ...manifest, _manifestCid: "bafyActive" },
    });

    const result = await ctx.mod.saveAssetDraftCore("Test Asset", {
      publishContext: { tokenId: "7", chainId: 31337 },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-changes");
    expect(ctx.mocks.writeJSONToIPFS).not.toHaveBeenCalled();
    expect(ctx.mocks.snapshotCommentsArchive).not.toHaveBeenCalled();
  });

  it("starts thumbnail capture concurrently with manifest preparation", async () => {
    const ctx = await load();
    const manifest = makeManifest();
    // Force prepare to fetch the manifest from IPFS (cache CID mismatch) so we
    // can observe whether the thumbnail capture had already started by then.
    ctx.assetState.set({
      activeAssetManifestCid: "bafyActive",
      latestAssetManifestCid: "bafyActive",
      currentManifest: { ...manifest, _manifestCid: "bafyStale" },
    });
    ctx.mocks.getPendingTransformEdits.mockReturnValue(
      new Map([["n1", [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]]])
    );

    let thumbnailStarted = false;
    const order = [];
    ctx.mocks.captureAssetThumbnail.mockImplementation(async () => {
      thumbnailStarted = true;
      order.push("thumbnail-start");
      return { cid: "bafyThumb" };
    });
    ctx.mocks.getFromRemoteIPFS.mockImplementation(async () => {
      order.push(
        thumbnailStarted ? "manifest-fetch-after-thumb" : "manifest-fetch-before-thumb"
      );
      return makeManifest();
    });
    ctx.mocks.writeJSONToIPFS.mockResolvedValue("bafyNewManifest");

    const result = await ctx.mod.saveAssetDraftCore("Test Asset", {
      captureThumbnail: true,
    });

    expect(result.ok).toBe(true);
    expect(order).toContain("manifest-fetch-after-thumb");
    const writtenManifest = ctx.mocks.writeJSONToIPFS.mock.calls[0][0];
    expect(writtenManifest.thumbnail).toEqual({ cid: "bafyThumb" });
  });

  it("does not capture a thumbnail when captureThumbnail is false", async () => {
    const ctx = await load();
    seedChangedSave(ctx);
    ctx.mocks.writeJSONToIPFS.mockResolvedValue("bafyNewManifest");

    await ctx.mod.saveAssetDraftCore("Test Asset");

    expect(ctx.mocks.captureAssetThumbnail).not.toHaveBeenCalled();
  });
});
