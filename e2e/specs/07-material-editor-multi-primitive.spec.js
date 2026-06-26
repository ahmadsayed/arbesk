import { test, expect } from "@playwright/test";

/**
 * Regression spec for GitHub issue #25:
 * findMaterialByMeshName() early-returned after the FIRST matching primitive,
 * so applyMeshOverrideColors() silently left every subsequent primitive's
 * material at its original colour.
 *
 * The test imports the gltf utility directly in the browser via dynamic import
 * (no wallet / scene setup needed - the function is a pure JSON transform).
 */

// Minimal composite glTF with one mesh split across two primitives referencing
// two distinct materials - the canonical pattern for e.g. a vehicle body + glass.
const FIXTURE = {
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
      pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] }, // red
    },
    {
      name: "Glass",
      pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1] }, // green
    },
  ],
};

test.describe("material-editor: multi-primitive mesh color override (#25)", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the studio so that dynamic imports resolve from the same
    // origin as the served JS modules. No wallet or scene interaction needed.
    await page.goto("/studio.html");
  });

  test("applyMeshOverrideColors updates ALL primitive materials, not just the first", async ({
    page,
  }) => {
    const colors = await page.evaluate(async (fixture) => {
      const { applyMeshOverrideColors } = await import("/js/gltf/material-editor.js");
      // Deep-clone so repeated runs don't share mutated state.
      const gltf = JSON.parse(JSON.stringify(fixture));

      applyMeshOverrideColors(gltf, { VehicleBody: { color: "#0000ff" } });

      return {
        mat0: gltf.materials[0].pbrMetallicRoughness.baseColorFactor,
        mat1: gltf.materials[1].pbrMetallicRoughness.baseColorFactor,
      };
    }, FIXTURE);

    // Primitive 0 (material index 0) - was already updated before the fix.
    expect(colors.mat0[0]).toBeCloseTo(0, 2); // r
    expect(colors.mat0[1]).toBeCloseTo(0, 2); // g
    expect(colors.mat0[2]).toBeCloseTo(1, 2); // b → blue

    // Primitive 1 (material index 1) - was silently skipped before the fix.
    expect(colors.mat1[0]).toBeCloseTo(0, 2); // r
    expect(colors.mat1[1]).toBeCloseTo(0, 2); // g
    expect(colors.mat1[2]).toBeCloseTo(1, 2); // b → blue (previously stayed green)
  });

  test("applyMeshOverrideColors with a defaultColor baseline reaches all materials", async ({
    page,
  }) => {
    const colors = await page.evaluate(async (fixture) => {
      const { applyMeshOverrideColors } = await import("/js/gltf/material-editor.js");
      const gltf = JSON.parse(JSON.stringify(fixture));

      // The default-colour branch iterates composite.materials directly,
      // so it was never affected by the bug - but the fixture still validates
      // that path alongside the per-mesh override path.
      applyMeshOverrideColors(gltf, { VehicleBody: { color: "#0000ff" } }, "#ffffff");

      return {
        mat0: gltf.materials[0].pbrMetallicRoughness.baseColorFactor,
        mat1: gltf.materials[1].pbrMetallicRoughness.baseColorFactor,
      };
    }, FIXTURE);

    // Both materials should carry the per-mesh override (blue), not the default (white),
    // because the per-mesh map is applied after the baseline.
    expect(colors.mat0[2]).toBeCloseTo(1, 2); // blue
    expect(colors.mat1[2]).toBeCloseTo(1, 2); // blue - not white and not the original green
  });
});
