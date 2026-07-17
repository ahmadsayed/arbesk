/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

function blobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

describe("3mf format handler", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("is registered by formats/index.js", async () => {
    const { listFormatHandlers } = await import(
      "../../frontend/src/js/formats/index.js"
    );
    const formats = listFormatHandlers().map((h) => h.format);
    expect(formats).toContain("gltf");
    expect(formats).toContain("glb");
    expect(formats).toContain("3mf");
  });

  it("isStoredForm only accepts the composite path", async () => {
    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    expect(
      threeMfHandler.isStoredForm({
        source: { format: "3mf", path: "composite.3mf.json" },
      })
    ).toBe(true);
    expect(
      threeMfHandler.isStoredForm({
        source: { format: "3mf", path: "asset.3mf" },
      })
    ).toBe(false);
  });

  it("sniff accepts 3MF packages and rejects other bytes", async () => {
    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    const box = new Uint8Array(fs.readFileSync(BOX_PATH));
    expect(threeMfHandler.sniff(box)).toBe(true);
    expect(threeMfHandler.sniff(new TextEncoder().encode("{}"))).toBe(false);
    // GLB magic ("glTF") must not match
    expect(
      threeMfHandler.sniff(new Uint8Array([0x67, 0x6c, 0x54, 0x46]))
    ).toBe(false);
  });

  it("is used by decomposeManifestNodes for 3mf nodes", async () => {
    // Import manifest-builder FIRST: it registers the built-in handlers as a
    // side effect of formats/index.js. Resetting afterwards gives us a clean
    // registry where only our spy handler exists.
    const { decomposeManifestNodes } = await import(
      "../../frontend/src/js/services/asset-save/manifest-builder.js"
    );
    const { registerFormatHandler, _resetFormatRegistry } = await import(
      "../../frontend/src/js/formats/registry.js"
    );
    _resetFormatRegistry();

    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    const spy = jest.fn().mockResolvedValue({
      cid: "bafyComposite3mf",
      path: "composite.3mf.json",
      format: "3mf",
    });
    registerFormatHandler({ ...threeMfHandler, decomposeForSave: spy });

    const manifest = {
      name: "Box",
      asset_id: "asset_box",
      scene: {
        nodes: [
          {
            node_id: "n1",
            source: { cid: "bafyRaw3mf", path: "asset.3mf", format: "3mf" },
          },
        ],
      },
    };
    await decomposeManifestNodes(manifest, new Map(), new Map());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyComposite3mf",
      path: "composite.3mf.json",
      format: "3mf",
    });
  });

  it("load converts a raw 3MF CID into a glTF blob", async () => {
    const box = new Uint8Array(fs.readFileSync(BOX_PATH));
    jest.unstable_mockModule(
      "../../frontend/src/js/ipfs/remote-ipfs.js",
      () => ({
        getArrayBufferFromRemoteIPFS: jest.fn(async () =>
          box.buffer.slice(box.byteOffset, box.byteOffset + box.byteLength)
        ),
      })
    );
    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    const importFromBlob = jest
      .fn()
      .mockResolvedValue({ meshes: [], transformNodes: [] });
    await threeMfHandler.load(
      { cid: "bafyRaw3mf" },
      { cid: "bafyRaw3mf", importFromBlob }
    );
    expect(importFromBlob).toHaveBeenCalledTimes(1);
    const [blob, extension] = importFromBlob.mock.calls[0];
    expect(extension).toBe(".gltf");
    const gltf = JSON.parse(await blobText(blob));
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.meshes).toHaveLength(1);
  });

  it("decomposeForSave normalizes an already-composite source", async () => {
    const composite = {
      arbesk_format: "composite-3mf",
      modelPath: "3D/3dmodel.model",
      contentTypes: "<Types/>",
      rootRels: "<Relationships/>",
      modelRels: null,
      model: "<model/>",
      parts: {},
    };
    const compositeBytes = new TextEncoder().encode(JSON.stringify(composite));
    jest.unstable_mockModule(
      "../../frontend/src/js/ipfs/remote-ipfs.js",
      () => ({
        getArrayBufferFromRemoteIPFS: jest.fn(async () =>
          compositeBytes.buffer.slice(
            compositeBytes.byteOffset,
            compositeBytes.byteOffset + compositeBytes.byteLength
          )
        ),
      })
    );
    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    const result = await threeMfHandler.decomposeForSave(
      { source: { cid: "bafyComposite", path: "asset.3mf", format: "3mf" } },
      { assetName: "Box", assetId: "asset_box", dedupMap: new Map() }
    );
    expect(result).toEqual({
      cid: "bafyComposite",
      path: "composite.3mf.json",
      format: "3mf",
      normalizeOnly: true,
    });
  });

  it("decomposeForSave throws on an unrecognized non-ZIP source", async () => {
    const garbage = new TextEncoder().encode("definitely not zip or json\x00\x01");
    jest.unstable_mockModule(
      "../../frontend/src/js/ipfs/remote-ipfs.js",
      () => ({
        getArrayBufferFromRemoteIPFS: jest.fn(async () =>
          garbage.buffer.slice(
            garbage.byteOffset,
            garbage.byteOffset + garbage.byteLength
          )
        ),
      })
    );
    const { threeMfHandler } = await import(
      "../../frontend/src/js/formats/handlers/3mf-handler.js"
    );
    await expect(
      threeMfHandler.decomposeForSave(
        { source: { cid: "bafyGarbage", path: "asset.3mf", format: "3mf" } },
        { assetName: "Box", assetId: "asset_box", dedupMap: new Map() }
      )
    ).rejects.toThrow();
  });
});
