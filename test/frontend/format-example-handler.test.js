/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

describe("example format handler extension point", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("is not registered by formats/index.js", async () => {
    const { listFormatHandlers } = await import(
      "../../frontend/src/js/formats/index.js"
    );
    const formats = listFormatHandlers().map((h) => h.format);
    expect(formats).toContain("gltf");
    expect(formats).toContain("glb");
    expect(formats).not.toContain("example");
  });

  it("can be registered and used for decompose without touching core code", async () => {
    const {
      registerFormatHandler,
      _resetFormatRegistry,
    } = await import("../../frontend/src/js/formats/registry.js");
    _resetFormatRegistry();

    const { createExampleFormatHandler } = await import(
      "./fixtures/example-format.js"
    );
    const handler = createExampleFormatHandler();
    handler.decomposeForSave = jest.fn().mockResolvedValue({
      cid: "bafyExample",
      path: "asset.example",
      format: "example",
    });
    registerFormatHandler(handler);

    const { decomposeManifestNodes } = await import(
      "../../frontend/src/js/services/asset-save/manifest-builder.js"
    );

    const manifest = {
      name: "Test",
      asset_id: "asset_1",
      scene: {
        nodes: [
          {
            node_id: "n1",
            source: { cid: "bafyInput", format: "example" },
          },
        ],
      },
    };

    await decomposeManifestNodes(manifest, new Map(), new Map());

    expect(handler.decomposeForSave).toHaveBeenCalledTimes(1);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyExample",
      path: "asset.example",
      format: "example",
    });
  });
});
