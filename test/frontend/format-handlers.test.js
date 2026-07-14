/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();

  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
    getFromRemoteIPFS: jest.fn(),
    getBase64FromRemoteIPFS: jest.fn(),
    getBlobFromRemoteIPFS: jest.fn(),
    getArrayBufferFromRemoteIPFS: jest.fn(),
    getRawArrayBufferFromRemoteIPFS: jest.fn(),
    getManifestChain: jest.fn(),
    isIpfsCidReachable: jest.fn(),
    clearRemoteIPFSCache: jest.fn(),
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

  jest.unstable_mockModule("../../frontend/src/js/gltf/decomposer.js", () => ({
    isComposite: jest.fn(),
    decomposeGlTF: jest.fn(),
    decomposeAndStore: jest.fn(),
  }));

  const gltf = await import(
    "../../frontend/src/js/formats/handlers/gltf-handler.js"
  );
  const glb = await import(
    "../../frontend/src/js/formats/handlers/glb-handler.js"
  );
  const remote = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  const asyncGltf = await import("../../frontend/src/js/gltf/async-gltf.js");
  const decomposer = await import("../../frontend/src/js/gltf/decomposer.js");
  return {
    gltfHandler: gltf.gltfHandler,
    glbHandler: glb.glbHandler,
    remote,
    asyncGltf,
    decomposer,
  };
}

describe("gltf handler", () => {
  let ctx;

  beforeEach(async () => {
    ctx = await load();
  });

  it("loads via importFromBlob with .gltf extension", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    const blob = new Blob(["gltf"], { type: "model/gltf+json" });
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(gltfJson);
    ctx.asyncGltf.composeGlTFToBlobAsync.mockResolvedValue(blob);
    const importFromBlob = jest.fn().mockResolvedValue({ meshes: ["m1"] });

    const result = await ctx.gltfHandler.load(
      { cid: "bafyGltf", format: "gltf" },
      { cid: "bafyGltf", importFromBlob }
    );

    expect(result).toEqual({ meshes: ["m1"] });
    expect(importFromBlob).toHaveBeenCalledWith(blob, ".gltf");
  });

  it("returns normalizeOnly for already-composite glTF", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(gltfJson);
    ctx.decomposer.isComposite.mockReturnValue(true);

    const result = await ctx.gltfHandler.decomposeForSave(
      { source: { cid: "bafyComposite", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyComposite",
      path: "composite.gltf",
      format: "gltf",
      normalizeOnly: true,
    });
  });

  it("decomposes non-composite glTF", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(gltfJson);
    ctx.decomposer.isComposite.mockReturnValue(false);
    ctx.asyncGltf.decomposeAndStoreAsync.mockResolvedValue({
      compositeCid: "bafyNew",
    });

    const result = await ctx.gltfHandler.decomposeForSave(
      { source: { cid: "bafyOld", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyNew",
      path: "composite.gltf",
      format: "gltf",
    });
  });

  it("returns null for non-glTF JSON", async () => {
    ctx.remote.getFromRemoteIPFS.mockResolvedValue({ not: "gltf" });

    const result = await ctx.gltfHandler.decomposeForSave(
      { source: { cid: "bafyOther", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toBeNull();
  });

  it("identifies stored composite form", async () => {
    expect(
      ctx.gltfHandler.isStoredForm({
        source: { format: "gltf", path: "composite.gltf" },
      })
    ).toBe(true);
    expect(
      ctx.gltfHandler.isStoredForm({
        source: { format: "gltf", path: "asset.gltf" },
      })
    ).toBe(false);
  });
});

describe("glb handler", () => {
  let ctx;

  beforeEach(async () => {
    ctx = await load();
  });

  it("sniffs glTF magic", async () => {
    const magic = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    expect(ctx.glbHandler.sniff(magic)).toBe(true);
    expect(ctx.glbHandler.sniff(new Uint8Array([0, 0, 0, 0]))).toBe(false);
  });

  it("loads via importFromBlob with .glb extension", async () => {
    const blob = new Blob(["glb"], { type: "model/gltf-binary" });
    ctx.remote.getBlobFromRemoteIPFS.mockResolvedValue(blob);
    const importFromBlob = jest.fn().mockResolvedValue({ meshes: ["m1"] });

    const result = await ctx.glbHandler.load(
      { cid: "bafyGlb", format: "glb" },
      { cid: "bafyGlb", importFromBlob }
    );

    expect(result).toEqual({ meshes: ["m1"] });
    expect(importFromBlob).toHaveBeenCalledWith(blob, ".glb");
  });

  it("decomposes GLB to composite glTF", async () => {
    ctx.remote.getArrayBufferFromRemoteIPFS.mockResolvedValue(
      new ArrayBuffer(10)
    );
    ctx.asyncGltf.decomposeGLBAsync.mockResolvedValue({
      compositeCid: "bafyComposite",
    });

    const result = await ctx.glbHandler.decomposeForSave(
      { source: { cid: "bafyGlb", format: "glb" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyComposite",
      path: "composite.gltf",
      format: "gltf",
    });
  });
});
