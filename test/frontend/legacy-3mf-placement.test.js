/**
 * Legacy 3MF placements (engine/legacy-3mf-placement.ts): manifests saved
 * before 3MF renders were scaled from millimetres to metres stored their
 * translations in millimetre-sized scene units; loading converts them so the
 * part sits where it did (on the floor) instead of ~1000× too far away.
 */
import { describe, expect, test } from "bun:test";
import {
  LEGACY_3MF_PLACEMENT_CUTOFF_MS,
  normalizeLegacy3mfPlacements,
} from "../../frontend/src/js/engine/legacy-3mf-placement.ts";

/** gridfinity v8 (saved 2026-10-06): dropped to the floor, lifted half its 45.75 mm height. */
function gridfinity(overrides = {}) {
  return {
    type: "asset",
    name: "gridfinity",
    timestamp: 1791298270184,
    scene: {
      nodes: [
        {
          node_id: "gridfinity_1791269679900",
          type: "source_asset",
          source: { cid: "bafy3mf", path: "composite.3mf.json", format: "3mf" },
          transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 22.875, 0, 1],
        },
      ],
    },
    ...overrides,
  };
}

const translation = (node) => node.transform_matrix.slice(12, 15);

describe("normalizeLegacy3mfPlacements", () => {
  test("converts a pre-cutoff 3MF node's translation from mm to metres", () => {
    const manifest = normalizeLegacy3mfPlacements(gridfinity());
    const [x, y, z] = translation(manifest.scene.nodes[0]);
    expect(x).toBe(0);
    expect(y).toBeCloseTo(0.022875, 9);
    expect(z).toBe(0);
    // Rotation/scale part of the matrix is untouched.
    expect(manifest.scene.nodes[0].transform_matrix.slice(0, 12)).toEqual(
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    );
  });

  test("leaves manifests saved after the cutoff alone", () => {
    const manifest = normalizeLegacy3mfPlacements(
      gridfinity({ timestamp: LEGACY_3MF_PLACEMENT_CUTOFF_MS + 1 }),
    );
    expect(translation(manifest.scene.nodes[0])).toEqual([0, 22.875, 0]);
  });

  test("is idempotent on the same manifest object", () => {
    const manifest = gridfinity();
    normalizeLegacy3mfPlacements(manifest);
    normalizeLegacy3mfPlacements(manifest);
    expect(translation(manifest.scene.nodes[0])[1]).toBeCloseTo(0.022875, 9);
  });

  test("only 3MF source nodes change; glTF and child-ref nodes keep their placement", () => {
    const manifest = gridfinity();
    manifest.scene.nodes.push(
      {
        node_id: "gltf",
        source: { cid: "bafyglb", format: "glb" },
        transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1],
      },
      {
        node_id: "child",
        child_ref: { assetID: "a", collection: { chainId: 1, contractAddress: "0x0", tokenId: "1" } },
        transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
      },
    );
    normalizeLegacy3mfPlacements(manifest);
    expect(translation(manifest.scene.nodes[1])).toEqual([2, 3, 4]);
    expect(translation(manifest.scene.nodes[2])).toEqual([5, 6, 7]);
  });

  test("tolerates manifests without timestamps, nodes or matrices", () => {
    expect(normalizeLegacy3mfPlacements(null)).toBe(null);
    for (const timestamp of [undefined, null, "1791298270184"]) {
      const noTime = gridfinity({ timestamp });
      expect(translation(normalizeLegacy3mfPlacements(noTime).scene.nodes[0])).toEqual([0, 22.875, 0]);
    }
    const noMatrix = gridfinity();
    delete noMatrix.scene.nodes[0].transform_matrix;
    expect(() => normalizeLegacy3mfPlacements(noMatrix)).not.toThrow();
    expect(() => normalizeLegacy3mfPlacements({ type: "collection" })).not.toThrow();
  });
});
