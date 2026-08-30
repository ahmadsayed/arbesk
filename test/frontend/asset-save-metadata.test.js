/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const { computeAssetStats } = await import(
  "../../frontend/src/js/services/asset-save/metadata-extract.js"
);

describe("computeAssetStats", () => {
  test("extracts stats from the root source node's composite glTF JSON", async () => {
    const manifest = {
      scene: {
        nodes: [
          {
            node_id: "root",
            source: { cid: "bafyComposite", format: "gltf" },
          },
        ],
      },
    };
    const readJson = async () => ({
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { count: 6, min: [0, 0, 0], max: [2, 4, 6] },
        { count: 6 },
      ],
      materials: [{}],
      textures: [],
      animations: [{ name: "idle" }],
      skins: [],
      nodes: [],
    });
    const stats = await computeAssetStats(manifest, readJson);
    expect(stats.format).toBe("gltf");
    expect(stats.dimensions).toEqual({ width: 2, height: 4, depth: 6, unit: "meters" });
    expect(stats.triangle_count).toBe(2);
  });

  test("returns format-only for 3mf sources", async () => {
    const manifest = {
      scene: { nodes: [{ node_id: "r", source: { cid: "x", format: "3mf" } }] },
    };
    const readJson = async () => { throw new Error("should not fetch"); };
    const stats = await computeAssetStats(manifest, readJson);
    expect(stats).toEqual({ format: "3mf" });
  });

  test("returns null when there is no root source node", async () => {
    const stats = await computeAssetStats({ scene: { nodes: [] } }, async () => ({}));
    expect(stats).toBeNull();
  });

  test("computeAssetStats does not disturb existing annotations (carry-forward)", async () => {
    const manifest = {
      metadata: { annotations: { character_name: "Knight" } },
      scene: { nodes: [{ node_id: "r", source: { cid: "bafy", format: "gltf" } }] },
    };
    const readJson = async () => ({ meshes: [], nodes: [], animations: [], skins: [] });
    await computeAssetStats(manifest, readJson);
    expect(manifest.metadata.annotations).toEqual({ character_name: "Knight" });
  });
});
