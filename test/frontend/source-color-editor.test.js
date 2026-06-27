import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();
  jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      getFromRemoteIPFS: jest.fn(),
      getArrayBufferFromRemoteIPFS: jest.fn(),
    }),
  );
  jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/write-to-ipfs.js",
    () => ({
      writeJSONToIPFS: jest.fn(),
    }),
  );
  jest.unstable_mockModule("../../frontend/src/js/gltf/glb-parser.js", () => ({
    isGLB: jest.fn(),
    decomposeGLB: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/gltf/source-color-editor.js");
  const remote = await import("../../frontend/src/js/ipfs/remote-ipfs.js");
  const write = await import("../../frontend/src/js/ipfs/write-to-ipfs.js");
  const glb = await import("../../frontend/src/js/gltf/glb-parser.js");
  return { mod, remote, write, glb };
}

function makeGltf({ sharedMaterial = false } = {}) {
  if (sharedMaterial) {
    return {
      nodes: [
        { name: "Body", mesh: 0 },
        { name: "Other", mesh: 1 },
      ],
      meshes: [
        {
          primitives: [{ material: 0 }, { material: 0 }],
        },
        {
          primitives: [{ material: 0 }],
        },
      ],
      materials: [{ name: "mat0" }],
    };
  }
  return {
    nodes: [
      { name: "Body", mesh: 0 },
      { name: "Wheel", mesh: 1 },
      { name: "NoMesh" },
    ],
    meshes: [
      {
        primitives: [{ material: 0 }, { material: 1 }],
      },
      {
        primitives: [{ material: 2 }],
      },
    ],
    materials: [{ name: "mat0" }, { name: "mat1" }, { name: "mat2" }],
  };
}

describe("applyNodeColors", () => {
  let mod;

  beforeEach(async () => {
    ({ mod } = await load());
  });

  it("applies a hex color to the named node's materials", () => {
    const gltf = makeGltf();
    const stats = mod.applyNodeColors(gltf, { Body: "#ff0000" });

    expect(stats).toEqual({ modified: 1, skipped: 0 });
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
    expect(gltf.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
  });

  it("matches node names case-insensitively", () => {
    const gltf = makeGltf();
    mod.applyNodeColors(gltf, { body: "#00ff00" });
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor[1]).toBe(1);
  });

  it("supports hex strings without a leading #", () => {
    const gltf = makeGltf();
    mod.applyNodeColors(gltf, { Body: "0000ff" });
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor[2]).toBe(1);
  });

  it("skips unknown node names", () => {
    const gltf = makeGltf();
    const stats = mod.applyNodeColors(gltf, { Missing: "#ff0000" });

    expect(stats).toEqual({ modified: 0, skipped: 1 });
  });

  it("skips nodes that have no mesh", () => {
    const gltf = makeGltf();
    const stats = mod.applyNodeColors(gltf, { NoMesh: "#ff0000" });

    expect(stats).toEqual({ modified: 0, skipped: 1 });
  });

  it("skips primitives that have no material", () => {
    const gltf = makeGltf();
    gltf.meshes[0].primitives.push({});
    const stats = mod.applyNodeColors(gltf, { Body: "#ff0000" });

    expect(stats).toEqual({ modified: 1, skipped: 0 });
  });

  it("clones a shared material so only the target node changes color", () => {
    const gltf = makeGltf({ sharedMaterial: true });
    const stats = mod.applyNodeColors(gltf, { Body: "#ff0000" });

    expect(stats).toEqual({ modified: 1, skipped: 0 });
    expect(gltf.materials).toHaveLength(2);
    expect(gltf.materials[0].pbrMetallicRoughness).toBeUndefined();
    expect(gltf.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
    expect(gltf.materials[1].name).toBe("Body_color");

    // The other node must still reference the original material.
    expect(gltf.meshes[1].primitives[0].material).toBe(0);
    // The target node's primitives must reference the clone.
    expect(gltf.meshes[0].primitives[0].material).toBe(1);
    expect(gltf.meshes[0].primitives[1].material).toBe(1);
  });

  it("does not clone when the material is already unique to the node", () => {
    const gltf = makeGltf();
    const beforeLength = gltf.materials.length;
    mod.applyNodeColors(gltf, { Wheel: "#ff0000" });

    expect(gltf.materials).toHaveLength(beforeLength);
    expect(gltf.materials[2].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
  });

  it("handles multiple nodes in one call", () => {
    const gltf = makeGltf();
    const stats = mod.applyNodeColors(gltf, {
      Body: "#ff0000",
      Wheel: "#0000ff",
    });

    expect(stats).toEqual({ modified: 2, skipped: 0 });
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
    expect(gltf.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([
      1, 0, 0, 1,
    ]);
    expect(gltf.materials[2].pbrMetallicRoughness.baseColorFactor).toEqual([
      0, 0, 1, 1,
    ]);
  });
});

describe("editSourceColors", () => {
  let ctx;

  beforeEach(async () => {
    ctx = await load();
    ctx.remote.getFromRemoteIPFS.mockResolvedValue(makeGltf());
    ctx.remote.getArrayBufferFromRemoteIPFS.mockResolvedValue(new ArrayBuffer(8));
    ctx.glb.isGLB.mockReturnValue(false);
    ctx.write.writeJSONToIPFS.mockResolvedValue("bafyNew");
  });

  it("throws when sourceCid is missing", async () => {
    await expect(ctx.mod.editSourceColors("", { Body: "#ff0000" })).rejects.toThrow(
      "sourceCid is required",
    );
  });

  it("returns the original CID when there are no color edits", async () => {
    const result = await ctx.mod.editSourceColors("bafyOld", {});
    expect(result).toEqual({ sourceCid: "bafyOld", modified: 0, skipped: 0 });
    expect(ctx.remote.getFromRemoteIPFS).not.toHaveBeenCalled();
  });

  it("edits a glTF JSON source and writes the new CID", async () => {
    const result = await ctx.mod.editSourceColors("bafyOld", {
      Body: "#ff0000",
    });

    expect(ctx.remote.getFromRemoteIPFS).toHaveBeenCalledWith("bafyOld");
    expect(ctx.write.writeJSONToIPFS).toHaveBeenCalledWith(
      expect.objectContaining({
        materials: expect.arrayContaining([
          expect.objectContaining({
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0, 0, 1],
            },
          }),
        ]),
      }),
      null,
      expect.objectContaining({ compress: true }),
    );
    expect(result).toMatchObject({
      sourceCid: "bafyNew",
      format: "gltf",
      modified: 1,
      skipped: 0,
    });
    expect(result.path).toBeUndefined();
  });

  it("decomposes a GLB source and reports the composite path", async () => {
    ctx.glb.isGLB.mockReturnValue(true);
    ctx.glb.decomposeGLB.mockResolvedValue({ composite: makeGltf() });

    const result = await ctx.mod.editSourceColors("bafyGlb", { Body: "#ff0000" });

    expect(ctx.remote.getArrayBufferFromRemoteIPFS).toHaveBeenCalledWith("bafyGlb");
    expect(ctx.glb.decomposeGLB).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      undefined,
      expect.objectContaining({ storeComposite: false }),
    );
    expect(result).toMatchObject({
      sourceCid: "bafyNew",
      format: "gltf",
      path: "composite.gltf",
      modified: 1,
      skipped: 0,
    });
  });

  it("propagates fetch errors", async () => {
    ctx.remote.getFromRemoteIPFS.mockRejectedValue(new Error("gateway down"));

    await expect(
      ctx.mod.editSourceColors("bafyOld", { Body: "#ff0000" }),
    ).rejects.toThrow("gateway down");
  });

  it("passes assetName and assetId through to the filename", async () => {
    await ctx.mod.editSourceColors("bafyOld", { Body: "#ff0000" }, {
      assetName: "MyAsset",
      assetId: "asset_1",
    });

    expect(ctx.write.writeJSONToIPFS).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.objectContaining({
        assetId: "asset_1",
        filename: "MyAsset_colored.gltf",
      }),
    );
  });
});
