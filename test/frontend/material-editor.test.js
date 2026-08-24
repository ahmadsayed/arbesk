import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();
  // The editor now consumes the IPFS ports via getRuntime(); the pure
  // applyMeshOverrideColors paths under test never touch the runtime, so no
  // port fakes are needed here.
  const mod = await import("@arbesk/asset-core/gltf/material-editor.js");
  return { mod };
}

function makeComposite() {
  return {
    asset: { version: "2.0" },
    meshes: [
      {
        name: "VehicleBody",
        primitives: [
          { attributes: {}, material: 0 },
          { attributes: {}, material: 1 },
        ],
      },
    ],
    materials: [
      {
        name: "BodyPaint",
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
      },
      {
        name: "Glass",
        pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] },
      },
    ],
  };
}

describe("applyMeshOverrideColors", () => {
  let mod;

  beforeEach(async () => {
    ({ mod } = await load());
  });

  it("updates ALL primitive materials for a multi-primitive mesh, not just the first", () => {
    const composite = makeComposite();

    const stats = mod.applyMeshOverrideColors(composite, {
      VehicleBody: { color: "#0000ff" },
    });

    expect(stats).toEqual({ modified: 1, skipped: 0 });
    // Primitive 0 (material index 0)
    expect(composite.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      0, 0, 1, 1,
    ]);
    // Primitive 1 (material index 1) — was silently skipped before the fix
    expect(composite.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it("applies per-mesh override after the defaultColor baseline, reaching all materials", () => {
    const composite = makeComposite();

    const stats = mod.applyMeshOverrideColors(
      composite,
      { VehicleBody: { color: "#0000ff" } },
      "#ffffff",
    );

    expect(stats).toEqual({ modified: 1, skipped: 0 });
    // Both materials should carry the per-mesh override (blue), not the default (white)
    expect(composite.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      0, 0, 1, 1,
    ]);
    expect(composite.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([
      0, 0, 1, 1,
    ]);
  });
});
