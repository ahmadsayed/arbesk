import { jest } from "@jest/globals";

const { computeModelStats } = await import(
  "../packages/asset-core/src/formats/gltf/model-stats.ts"
);

describe("computeModelStats", () => {
  test("extracts bounds, dimensions, center, origin, counts, clips, rig", () => {
    const gltf = {
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ translation: [1, 2, 3] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { count: 6, min: [0, 0, 0], max: [2, 4, 6] },
        { count: 6 },
      ],
      materials: [{}, {}],
      textures: [{}],
      animations: [{ name: "walk" }, {}],
      skins: [{ joints: [0, 1] }, { joints: [1, 2] }],
    };
    const s = computeModelStats(gltf, { format: "gltf" });
    expect(s.format).toBe("gltf");
    expect(s.dimensions).toEqual({ width: 2, height: 4, depth: 6, unit: "meters" });
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [2, 4, 6] });
    expect(s.center).toEqual([1, 2, 3]);
    expect(s.origin).toEqual([1, 2, 3]);
    expect(s.animation_clips).toEqual(["walk", "clip_1"]);
    expect(s.triangle_count).toBe(2);
    expect(s.vertex_count).toBe(6);
    expect(s.mesh_count).toBe(1);
    expect(s.material_count).toBe(2);
    expect(s.texture_count).toBe(1);
    expect(s.rigged).toBe(true);
    expect(s.bone_count).toBe(3);
  });

  test("omits bounds when there are no POSITION accessors", () => {
    const s = computeModelStats({ meshes: [{ primitives: [{}] }] }, { format: "glb" });
    expect(s.dimensions).toBeUndefined();
    expect(s.bounds).toBeUndefined();
    expect(s.center).toBeUndefined();
    expect(s.triangle_count).toBe(0);
  });

  test("3mf omits glTF-only fields", () => {
    const s = computeModelStats({}, { format: "3mf" });
    expect(s.format).toBe("3mf");
    expect(s.animation_clips).toBeUndefined();
    expect(s.origin).toBeUndefined();
    expect(s.rigged).toBeUndefined();
  });
});
